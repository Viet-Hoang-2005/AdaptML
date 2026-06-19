# Batch Training Module

This module provisions an optional AWS Batch backend for short-lived ML training jobs.
It is intended to run training outside the k3s cluster while reusing the existing VPC,
subnets, security groups, S3 artifacts bucket, and AWS provider configuration.

Default compute type is `FARGATE`. The root module passes the existing private subnet,
which works because the current network module creates a NAT Gateway for outbound access
to ECR, S3, and CloudWatch Logs.

If NAT Gateway is removed later, use one of these options:

- pass public subnets and set `batch_training_assign_public_ip = true`
- keep private subnets and add VPC endpoints for ECR, S3, and CloudWatch Logs

For larger datasets or jobs that need more CPU/RAM flexibility, set:

```hcl
batch_training_compute_environment_type = "EC2_SPOT"
```

EC2 Spot still uses AWS-managed Batch compute, not k3s worker nodes.
