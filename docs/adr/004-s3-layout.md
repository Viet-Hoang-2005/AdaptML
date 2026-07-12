# ADR 004: Project and Training-Job S3 Layout

Status: Accepted

Mutable code and data live at the model-project root. Every training job takes an
immutable input snapshot and owns output and MLflow prefixes. Registry versions
map selected job artifacts into immutable version metadata. Global MLflow roots,
version-scoped editable files, and duplicate source bundles are removed.
