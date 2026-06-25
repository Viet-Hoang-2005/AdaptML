locals {
  enable_shared_iam     = var.enable_compute || var.enable_legacy_sagemaker_pipeline
  enable_shared_secrets = var.enable_legacy_sagemaker_pipeline
  enable_lb_stack       = var.enable_alb && var.enable_compute && var.enable_dns
}

module "network" {
  source             = "./modules/network"
  enable_nat_gateway = var.enable_nat_gateway
}

module "security" {
  source                        = "./modules/security"
  vpc_id                        = module.network.vpc_id
  enable_legacy_security_groups = var.enable_compute || local.enable_lb_stack
}

module "storage" {
  source = "./modules/storage"
}

module "secrets" {
  count  = local.enable_shared_secrets ? 1 : 0
  source = "./modules/secrets"
}

module "iam" {
  count                      = local.enable_shared_iam ? 1 : 0
  source                     = "./modules/iam"
  artifacts_bucket_arn       = module.storage.bucket_arn
  github_secrets_arn         = local.enable_shared_secrets ? module.secrets[0].github_secrets_arn : "*"
  github_actions_secrets_arn = local.enable_shared_secrets ? module.secrets[0].github_actions_secrets_arn : "*"
  mlflow_basic_auth_arn      = local.enable_shared_secrets ? module.secrets[0].mlflow_basic_auth_arn : "*"

  enable_legacy_sagemaker_pipeline = var.enable_legacy_sagemaker_pipeline
}

module "compute" {
  count                = var.enable_compute ? 1 : 0
  source               = "./modules/compute"
  public_subnet_1a_id  = module.network.public_subnet_1a_id
  private_subnet_1a_id = module.network.private_subnet_1a_id
  master_sg_id         = module.security.master_sg_id
  worker_sg_id         = module.security.worker_sg_id
  worker_profile_name  = module.iam[0].worker_profile_name
}

module "dns" {
  count  = var.enable_dns ? 1 : 0
  source = "./modules/dns"
}

module "alb" {
  count               = local.enable_lb_stack ? 1 : 0
  source              = "./modules/alb"
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = [module.network.public_subnet_1a_id, module.network.public_subnet_1b_id]
  lb_sg_id            = module.security.lb_sg_id
  worker_instance_ids = module.compute[0].worker_instance_ids
  certificate_arn     = module.dns[0].certificate_arn
  zone_id             = module.dns[0].zone_id
  domain_name         = "api.mlops-nids-nt114.id.vn"
}

module "batch_training" {
  count  = var.enable_batch_training ? 1 : 0
  source = "./modules/batch"

  project_name          = var.project_name
  aws_region            = var.aws_region
  vpc_id                = module.network.vpc_id
  subnet_ids            = var.enable_nat_gateway ? [module.network.private_subnet_1a_id] : [module.network.public_subnet_1a_id, module.network.public_subnet_1b_id]
  security_group_ids    = [module.security.batch_training_sg_id]
  artifacts_bucket_name = module.storage.bucket_id
  training_runner_image = var.batch_training_runner_image
  vcpu                  = var.batch_training_vcpu
  memory                = var.batch_training_memory
  job_timeout           = var.batch_training_job_timeout

  compute_environment_type = var.batch_training_compute_environment_type
  max_vcpus                = var.batch_training_max_vcpus
  assign_public_ip         = var.enable_nat_gateway ? var.batch_training_assign_public_ip : true
}
