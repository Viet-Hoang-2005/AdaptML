# Production data contract for continuous training

The Consumer owns two PostgreSQL tables and writes them in one transaction for every Kafka batch.

| Table | Purpose | Retention and access |
| --- | --- | --- |
| `mlops_inference_events` | Minimal inference telemetry and prediction traceability. It intentionally excludes request features and raw payloads. | Operational retention policy. |
| `mlops_production_data` | Successful input samples for drift analysis, human labeling, evaluation, and continuous-training selection. | Data-governance retention policy. |

`mlops_production_data` has a logical `inference_event_id`; it is not a database foreign key so
telemetry can expire independently. A sample enters as `label_status=unlabeled`,
`data_quality_status=unchecked`, and `training_eligibility=false`. It must not be used for
retraining until a trusted workflow has recorded a label and passed the data-quality gate.

Automatic drift counts non-rejected samples from `mlops_production_data`. Evidently reads the same
table, scoped by model version. The owner-facing production-data endpoint is tenant and project
scoped.
