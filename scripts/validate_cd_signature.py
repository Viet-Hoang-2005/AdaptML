#!/usr/bin/env python3
"""Statically validate the CD keyless Cosign signing contract."""

from __future__ import annotations

import sys
from pathlib import Path


SIGNER_IDENTITY = (
    "https://github.com/Viet-Hoang-2005/MLOps-paas-system/"
    ".github/workflows/cd.yml@refs/heads/main"
)
SIGNER_ISSUER = "https://token.actions.githubusercontent.com"
REQUIRED_FRAGMENTS = (
    "id-token: write",
    'cosign sign --yes "${IMAGE_REFERENCE}"',
    'cosign verify "${IMAGE_REFERENCE}"',
    f'--certificate-identity="{SIGNER_IDENTITY}"',
    f'--certificate-oidc-issuer="{SIGNER_ISSUER}"',
)
FORBIDDEN_FRAGMENTS = (
    "COSIGN_PRIVATE_KEY",
    "COSIGN_PASSWORD",
    "cosign.key",
    "--key cosign.key",
)


def main() -> int:
    workflow = Path(__file__).resolve().parents[1] / ".github/workflows/cd.yml"
    content = workflow.read_text(encoding="utf-8")
    errors = [
        f"CD workflow is missing required keyless signing fragment: {fragment}"
        for fragment in REQUIRED_FRAGMENTS
        if fragment not in content
    ]
    errors.extend(
        f"CD workflow still contains prohibited key-based Cosign configuration: {fragment}"
        for fragment in FORBIDDEN_FRAGMENTS
        if fragment in content
    )
    if content.count("aws-actions/configure-aws-credentials") != 1:
        errors.append("only the build-and-push job may configure AWS credentials")
    if content.count("aws-actions/aws-secretsmanager-get-secrets") != 1:
        errors.append("only the build-and-push job may read AWS Secrets Manager")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Validated GitHub OIDC keyless Cosign signing and job-scoped AWS access.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
