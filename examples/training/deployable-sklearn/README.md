# Deployable sklearn training sample

This sample is meant to validate the Train-to-Deploy flow.

Files:

- `train.py`: reads CSV data from `SM_CHANNEL_TRAIN`, trains a small sklearn pipeline, and writes deployable artifacts to `SM_MODEL_DIR`.
- `requirements.txt`: minimal Python dependencies for the training job.
- `train.csv`: tiny CSV dataset for local/E2E smoke testing.

Expected training output inside `model.tar.gz`:

- `model.pkl`
- `label_mapping.json`
- `model_metadata.json`
- `requirements.txt` when the training runner provides it next to `train.py`

Create `source.zip` for the Training PaaS form:

```powershell
Compress-Archive -Path examples/training/deployable-sklearn/train.py -DestinationPath examples/training/deployable-sklearn/source.zip -Force
```

Upload these files on `/dashboard/model-training`:

- Source zip: `source.zip`
- Requirements: `requirements.txt`
- Training data: `train.csv`

The completed training artifact should be deployable because it contains `model.pkl`.
