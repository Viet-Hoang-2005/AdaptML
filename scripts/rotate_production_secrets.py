#!/usr/bin/env python3
"""Rotate compromised credentials without printing secret values.

Run only after untrusted workloads no longer receive production secrets.
OAuth secrets must first be regenerated at the provider and are read through
an interactive prompt. AWS IAM access-key rotation is opt-in and two-phase.
"""

import argparse
import getpass
import json
import secrets
import sys

import boto3
from botocore.exceptions import ClientError


def _parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="ap-southeast-1")
    parser.add_argument("--production-secret-id", default="mlops/production-secrets")
    parser.add_argument("--aws-secret-id", default="mlops/aws-secrets")
    parser.add_argument("--rotate-github-oauth", action="store_true")
    parser.add_argument("--rotate-google-oauth", action="store_true")
    parser.add_argument("--rotate-aws-access-key", action="store_true")
    parser.add_argument("--iam-user")
    parser.add_argument("--old-access-key-id")
    parser.add_argument("--disable-old-aws-access-key", action="store_true")
    parser.add_argument("--execute", action="store_true")
    return parser


def _read_json_secret(client, secret_id):
    response = client.get_secret_value(SecretId=secret_id)
    payload = json.loads(response["SecretString"])
    if not isinstance(payload, dict):
        raise RuntimeError(f"Secret {secret_id} must contain a JSON object.")
    return payload


def _jwt_key_pair():
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
    except ImportError as exc:
        raise RuntimeError("Install cryptography before rotating JWT keys.") from exc

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return private_pem, public_pem


def _provider_secret(prompt):
    value = getpass.getpass(prompt).strip()
    if len(value) < 16:
        raise RuntimeError("Provider secret is empty or unexpectedly short.")
    return value


def _rotate_application_secrets(client, secret_id, args):
    payload = _read_json_secret(client, secret_id)
    private_key, public_key = _jwt_key_pair()
    payload.update(
        {
            "CONTROL_PLANE_WEBHOOK_SECRET": secrets.token_urlsafe(48),
            "JWT_PRIVATE_KEY": private_key,
            "JWT_PUBLIC_KEY": public_key,
        }
    )
    rotated = ["CONTROL_PLANE_WEBHOOK_SECRET", "JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY"]
    if args.rotate_github_oauth:
        payload["GITHUB_OAUTH2_CLIENT_SECRET"] = _provider_secret("New GitHub OAuth client secret: ")
        rotated.append("GITHUB_OAUTH2_CLIENT_SECRET")
    if args.rotate_google_oauth:
        payload["GOOGLE_OAUTH2_CLIENT_SECRET"] = _provider_secret("New Google OAuth client secret: ")
        rotated.append("GOOGLE_OAUTH2_CLIENT_SECRET")
    if args.execute:
        client.put_secret_value(SecretId=secret_id, SecretString=json.dumps(payload))
    return rotated


def _rotate_aws_access_key(secrets_client, iam_client, args):
    if not args.rotate_aws_access_key:
        return []
    if not args.iam_user or not args.old_access_key_id:
        raise RuntimeError("--iam-user and --old-access-key-id are required for AWS access-key rotation.")
    if not args.execute:
        return ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]

    created = iam_client.create_access_key(UserName=args.iam_user)["AccessKey"]
    try:
        payload = _read_json_secret(secrets_client, args.aws_secret_id)
        payload.update(
            {
                "AWS_ACCESS_KEY_ID": created["AccessKeyId"],
                "AWS_SECRET_ACCESS_KEY": created["SecretAccessKey"],
            }
        )
        secrets_client.put_secret_value(
            SecretId=args.aws_secret_id,
            SecretString=json.dumps(payload),
        )
    except Exception:
        iam_client.delete_access_key(UserName=args.iam_user, AccessKeyId=created["AccessKeyId"])
        raise
    if args.disable_old_aws_access_key:
        iam_client.update_access_key(
            UserName=args.iam_user,
            AccessKeyId=args.old_access_key_id,
            Status="Inactive",
        )
    print(f"Created AWS access key {created['AccessKeyId']}; secret value was not printed.")
    return ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]


def main():
    args = _parser().parse_args()
    secrets_client = boto3.client("secretsmanager", region_name=args.region)
    iam_client = boto3.client("iam", region_name=args.region)
    try:
        rotated = _rotate_application_secrets(secrets_client, args.production_secret_id, args)
        rotated.extend(_rotate_aws_access_key(secrets_client, iam_client, args))
    except (ClientError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Rotation failed: {exc}", file=sys.stderr)
        return 1
    mode = "Rotated" if args.execute else "Dry run would rotate"
    print(f"{mode}: {', '.join(rotated)}")
    if args.execute:
        print("Restart consumers after External Secrets refresh; existing JWTs are intentionally revoked.")
    else:
        print("No remote secret or IAM access key was changed. Re-run with --execute after review.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
