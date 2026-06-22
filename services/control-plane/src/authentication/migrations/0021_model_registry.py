# Migration: Model Evolution Registry
# Creates ModelFamily, ModelVersion, ModelDeploymentHistory, ModelMetric.
# Depends on 0020_merge_chore_and_endpoint_heads (the combined HEAD of the merged graph).

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0020_merge_chore_and_endpoint_heads"),
    ]

    operations = [
        # ── ModelFamily ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name="ModelFamily",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="model_families",
                        to="authentication.customuser",
                    ),
                ),
                ("name", models.CharField(max_length=160)),
                ("display_name", models.CharField(blank=True, max_length=200)),
                ("description", models.TextField(blank=True)),
                # current_production_version FK is added later (after ModelVersion table exists)
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-updated_at"],
            },
        ),
        migrations.AddIndex(
            model_name="modelfamily",
            index=models.Index(fields=["tenant", "is_active"], name="reg_family_tenant_active_idx"),
        ),
        migrations.AlterUniqueTogether(
            name="modelfamily",
            unique_together={("tenant", "name")},
        ),

        # ── ModelVersion ─────────────────────────────────────────────────────────
        migrations.CreateModel(
            name="ModelVersion",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="model_versions",
                        to="authentication.customuser",
                    ),
                ),
                (
                    "family",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="versions",
                        to="authentication.modelfamily",
                    ),
                ),
                ("version", models.CharField(max_length=80)),
                (
                    "model_api",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="registry_version",
                        to="authentication.modelapi",
                    ),
                ),
                (
                    "source_training_job",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="registry_versions",
                        to="authentication.trainingjob",
                    ),
                ),
                (
                    "source_type",
                    models.CharField(
                        choices=[
                            ("manual_upload", "Manual Upload"),
                            ("training_job", "Training Job"),
                            ("imported", "Imported"),
                        ],
                        default="manual_upload",
                        max_length=30,
                    ),
                ),
                ("artifact_uri", models.CharField(blank=True, max_length=1024)),
                ("image_name", models.CharField(blank=True, max_length=200)),
                ("endpoint_url", models.CharField(blank=True, max_length=1024)),
                (
                    "stage",
                    models.CharField(
                        choices=[
                            ("none", "None"),
                            ("candidate", "Candidate"),
                            ("staging", "Staging"),
                            ("production", "Production"),
                            ("archived", "Archived"),
                        ],
                        default="none",
                        max_length=20,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="modelversion",
            index=models.Index(fields=["tenant", "stage"], name="reg_version_tenant_stage_idx"),
        ),
        migrations.AddIndex(
            model_name="modelversion",
            index=models.Index(fields=["family", "version"], name="reg_version_family_ver_idx"),
        ),
        migrations.AlterUniqueTogether(
            name="modelversion",
            unique_together={("family", "version")},
        ),

        # ── Add ModelFamily.current_production_version FK now that ModelVersion exists ──
        migrations.AddField(
            model_name="modelfamily",
            name="current_production_version",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="production_for_families",
                to="authentication.modelversion",
            ),
        ),

        # ── ModelDeploymentHistory ────────────────────────────────────────────────
        migrations.CreateModel(
            name="ModelDeploymentHistory",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="deployment_history",
                        to="authentication.customuser",
                    ),
                ),
                (
                    "family",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="history",
                        to="authentication.modelfamily",
                    ),
                ),
                (
                    "model_version",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="history",
                        to="authentication.modelversion",
                    ),
                ),
                (
                    "model_api",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="history_events",
                        to="authentication.modelapi",
                    ),
                ),
                (
                    "action",
                    models.CharField(
                        choices=[
                            ("registered", "Registered"),
                            ("built", "Built"),
                            ("deployed", "Deployed"),
                            ("health_checked", "Health Checked"),
                            ("stopped", "Stopped"),
                            ("redeployed", "Redeployed"),
                            ("promoted", "Promoted"),
                            ("rolled_back", "Rolled Back"),
                            ("archived", "Archived"),
                            ("failed", "Failed"),
                        ],
                        max_length=30,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("success", "Success"),
                            ("failed", "Failed"),
                            ("running", "Running"),
                        ],
                        default="success",
                        max_length=20,
                    ),
                ),
                ("from_stage", models.CharField(blank=True, max_length=20)),
                ("to_stage", models.CharField(blank=True, max_length=20)),
                ("message", models.TextField(blank=True)),
                ("extra", models.JSONField(blank=True, default=dict)),
                ("actor", models.CharField(blank=True, max_length=200)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="modeldeploymenthistory",
            index=models.Index(fields=["family", "created_at"], name="reg_history_family_ts_idx"),
        ),
        migrations.AddIndex(
            model_name="modeldeploymenthistory",
            index=models.Index(fields=["model_version", "action"], name="reg_history_ver_action_idx"),
        ),

        # ── ModelMetric ───────────────────────────────────────────────────────────
        migrations.CreateModel(
            name="ModelMetric",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="model_metrics",
                        to="authentication.customuser",
                    ),
                ),
                (
                    "family",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="metrics",
                        to="authentication.modelfamily",
                    ),
                ),
                (
                    "model_version",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="metrics",
                        to="authentication.modelversion",
                    ),
                ),
                ("metric_name", models.CharField(max_length=80)),
                ("metric_value", models.FloatField()),
                ("step", models.IntegerField(default=0)),
                (
                    "source",
                    models.CharField(
                        choices=[
                            ("training_log", "Training Log"),
                            ("mlflow", "MLflow"),
                            ("production", "Production"),
                            ("drift", "Drift"),
                        ],
                        default="training_log",
                        max_length=20,
                    ),
                ),
                ("extra", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["step", "metric_name"],
            },
        ),
        migrations.AddIndex(
            model_name="modelmetric",
            index=models.Index(fields=["model_version", "metric_name"], name="reg_metric_ver_name_idx"),
        ),
        migrations.AlterUniqueTogether(
            name="modelmetric",
            unique_together={("model_version", "metric_name", "step")},
        ),
    ]
