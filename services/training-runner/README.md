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

Build locally:

```bash
docker build -t mlops-training-runner ./services/training-runner
```
