# Train-to-Deploy E2E validation

This guide validates the local Train-to-Deploy flow:

Training Job -> Register as Model -> Build Package -> Deploy Endpoint -> Predict

## 1. Start the local stack

Use a real `.env` for AWS/S3 credentials when testing AWS Batch. Keep the Docker network name consistent so control-plane, model-packager, Traefik, and deployed endpoint containers can resolve each other:

```env
DOCKER_NETWORK_NAME=mlops_paas_network
MODEL_PACKAGER_URL=http://model-packager:7000
CONTROL_PLANE_INTERNAL_URL=http://control-plane:8000
CONTROL_PLANE_WEBHOOK_SECRET=change-me-local-build-webhook-secret
```

Start the required services. `--remove-orphans` and `--force-recreate` are intentional after branch merges because older compose revisions used different service names or network definitions while keeping the same container names:

```powershell
docker compose up -d --build --remove-orphans --force-recreate postgres redis redpanda traefik model-packager control-plane
```

Check compose syntax without starting containers:

```powershell
docker compose config --quiet
```

If you need the old local database volume for testing, set:

```env
POSTGRES_VOLUME_NAME=mlops-nids-system_mlops_paas_pgdata
```

## 2. Prepare the sample training files

Create the source zip:

```powershell
Compress-Archive -Path examples/training/deployable-sklearn/train.py -DestinationPath examples/training/deployable-sklearn/source.zip -Force
```

Use these files on `/dashboard/model-training`:

- Source zip: `examples/training/deployable-sklearn/source.zip`
- Requirements: `examples/training/deployable-sklearn/requirements.txt`
- Training data: `examples/training/deployable-sklearn/train.csv`
- Entry point: `train.py`

## 3. Create and complete a training job

1. Open `/dashboard/model-training`.
2. Click `New Training Job`.
3. Upload the sample files.
4. Choose a small runtime profile for smoke testing.
5. Submit and wait for status `completed`.
6. Confirm the Training Job Detail page shows a `model_artifact_uri` ending in `model.tar.gz`.

The sample writes `model.pkl`, `label_mapping.json`, `model_metadata.json`, and copies `requirements.txt` into `SM_MODEL_DIR` when available, so the produced `model.tar.gz` is deployable.

## 4. Register the completed job as a model

1. Open the completed Training Job Detail page.
2. In the Deployment section, click `Register as Model`.
3. Enter a model name and version. The default version should come from the training job model version.
4. Submit.

Expected result:

- A ModelAPI record is created.
- `source_type` is `training_job`.
- `source_training_job` points to the training job.
- `source_artifact_uri` is the job `model_artifact_uri`.

## 5. Build package and deploy endpoint

1. Click `Build Package` from the Training Job Detail deployment section, or open API Management and build the registered model.
2. Wait for build status to become ready/successful.
3. Click `Deploy Endpoint`.
4. Wait for endpoint status to become `healthy`.
5. Verify the endpoint URL includes the selected version:

```text
http://localhost:5000/<tenant-id>/models/<model-name>/<version>/predict
```

The older manual-upload flow should continue to use `v1` by default.

## 5.1 Deployment lifecycle checks

From API Management or the Training Job Detail deployment card:

- `Check health`: calls the endpoint health route and updates endpoint status.
- `Redeploy`: replaces the local endpoint container and waits for health.
- `Stop endpoint`: removes the local endpoint container but keeps the model registry record and S3 artifacts.
- `Endpoint logs`: reads recent Docker logs from the endpoint container.
- `Cleanup`: removes local Docker resources for the model. It does not delete S3 artifacts.

Useful backend checks:

```powershell
docker compose exec -T control-plane python src/manage.py shell -c "from authentication.models import ModelAPI; m=ModelAPI.objects.get(id=<model-id>); print(m.status, m.build_status, m.endpoint_status, m.endpoint_error)"
docker logs --tail=100 mlops_paas_model_endpoint_<model-id>
```

## 6. Test prediction

From Model Testing, select the deployed model. The UI should use the backend `endpoint_url` directly.

You can also test with curl:

```powershell
curl.exe -X POST "http://localhost:5000/<tenant-id>/models/<model-name>/<version>/predict" `
  -H "Content-Type: application/json" `
  -d "{\"features\":{\"f1\":1.0,\"f2\":2.0,\"f3\":3.0}}"
```

Expected result: a JSON prediction response from the deployed model container.

## 7. Validate a local artifact before deploy

If you have downloaded `model.tar.gz`, run:

```powershell
python scripts/validate_training_artifact.py path\to\model.tar.gz
```

Expected output should say the artifact is deployable and show the selected model file.

## 8. Manual upload regression

Also verify the original API Management flow:

1. Upload a raw `.pkl`, `.joblib`, or `.xgb` model.
2. Build package.
3. Deploy endpoint.
4. Confirm endpoint URL defaults to `/v1/predict`.
5. Test prediction from Model Testing.

## Troubleshooting

- If `control-plane` cannot resolve `postgres`, confirm all services are on the same compose network and `DOCKER_NETWORK_NAME` is consistent.
- If the build webhook returns 400, confirm `DJANGO_ALLOWED_HOSTS` includes `control-plane`.
- If the build webhook returns 403, confirm `CONTROL_PLANE_WEBHOOK_SECRET` is identical in control-plane and model-packager build containers.
- If endpoint health is unhealthy, open endpoint logs and check whether the model artifact can be downloaded from S3.
- If the public route returns 404, confirm the Traefik route path includes `/<tenant-id>/models/<model-name>/<version>/predict`.
- If PowerShell curl requests fail with JSON decode errors, write the JSON to a temporary file and use `--data-binary "@file.json"`.
- If the registered training model cannot build, download the artifact and run `scripts/validate_training_artifact.py`.
- If the artifact has no `.pkl`, `.joblib`, or `.xgb`, the training job completed but did not produce a deployable model for the current deploy flow.
