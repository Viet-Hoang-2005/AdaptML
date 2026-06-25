# Training Runner

Container runtime for the `TRAINING_BACKEND=aws_batch` backend.

The control plane submits AWS Batch jobs with these environment variables:

- `AWS_BUCKET_NAME`
- `S3_SOURCE_URI`
- `S3_TRAINING_DATA_URI`
- `S3_REQUIREMENTS_URI` optional
- `S3_OUTPUT_URI`
- `ENTRY_POINT`
- `MODEL_VERSION`
- `TRAINING_JOB_ID`

The runner downloads `source.zip` and `train.csv` from S3, extracts the source
under `/workspace/source`, copies the CSV to `/workspace/input/train/train.csv`,
installs `requirements.txt` when provided, and runs the configured entry point.

User training code should read:

- `SM_CHANNEL_TRAIN=/workspace/input/train`
- `SM_MODEL_DIR=/workspace/model`
- `SM_OUTPUT_DIR=/workspace/output`

After training, every file under `SM_MODEL_DIR` is packaged into `model.tar.gz`
and uploaded to `S3_OUTPUT_URI`.

Before packaging, the runner writes a metadata bundle under
`SM_MODEL_DIR/_mlops/`:

- `training_summary.json`
- `metrics.json`
- `params.json`
- `metric_events.jsonl`
- `artifact_manifest.json`
- `stdout.txt`
- `stderr.txt`
- `warnings.json`

User code does not need MLflow. To expose metrics, either print lines like
`METRIC_JSON:{"accuracy":0.95}` or write `SM_OUTPUT_DIR/metrics.json`. To expose
parameters, write `SM_OUTPUT_DIR/params.json`.

Build locally:

```bash
docker build -t mlops-training-runner ./services/training-runner
```
