#!/usr/bin/env python
"""Validate that a local TrainingJob model.tar.gz is deployable.

This is a local smoke-test helper. It does not download from S3.
"""

from __future__ import annotations

import argparse
import sys
import tarfile
from pathlib import PurePosixPath


SUPPORTED_SUFFIXES = (".pkl", ".joblib", ".xgb")
PREFERRED_NAMES = ("model.pkl", "model.joblib", "model.xgb")


def _safe_member_name(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts


def _select_model_file(names: list[str]) -> str | None:
    supported = sorted(name for name in names if name.lower().endswith(SUPPORTED_SUFFIXES))
    if not supported:
        return None

    basenames = {PurePosixPath(name).name: name for name in supported}
    for preferred in PREFERRED_NAMES:
        if preferred in basenames:
            return basenames[preferred]
    return supported[0]


def validate_artifact(path: str) -> int:
    try:
        with tarfile.open(path, "r:gz") as archive:
            members = archive.getmembers()
    except (tarfile.TarError, OSError) as exc:
        print(f"Invalid tar.gz artifact: {exc}", file=sys.stderr)
        return 2

    names: list[str] = []
    for member in members:
        if not _safe_member_name(member.name):
            print(f"Unsafe archive member path: {member.name}", file=sys.stderr)
            return 2
        if member.issym() or member.islnk():
            print(f"Unsafe archive link member: {member.name}", file=sys.stderr)
            return 2
        if member.isfile():
            names.append(member.name)

    model_file = _select_model_file(names)
    if not model_file:
        print("No deployable model file found. Expected .pkl, .joblib, or .xgb.", file=sys.stderr)
        return 1

    requirements = [name for name in names if PurePosixPath(name).name == "requirements.txt"]
    labels = [name for name in names if PurePosixPath(name).name == "label_mapping.json"]
    metadata = [name for name in names if PurePosixPath(name).name == "model_metadata.json"]

    print("Training artifact is deployable.")
    print(f"Selected model file: {model_file}")
    print(f"requirements.txt: {'yes' if requirements else 'no'}")
    print(f"label_mapping.json: {'yes' if labels else 'no'}")
    print(f"model_metadata.json: {'yes' if metadata else 'no'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a local TrainingJob model.tar.gz artifact.")
    parser.add_argument("artifact", help="Path to local model.tar.gz")
    args = parser.parse_args()
    return validate_artifact(args.artifact)


if __name__ == "__main__":
    raise SystemExit(main())
