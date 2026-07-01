locals {
  enable_shared_iam     = var.enable_compute || var.enable_github_actions_iam
  enable_shared_secrets = var.enable_github_actions_iam
  enable_lb_stack       = var.enable_alb && var.enable_compute && var.enable_dns
}

module "network" {
  source                 = "./modules/network"
  enable_nat_gateway     = var.enable_nat_gateway
  vpc_cidr               = var.vpc_cidr
  public_subnet_1a_cidr  = var.public_subnet_1a_cidr
  public_subnet_1b_cidr  = var.public_subnet_1b_cidr
  private_subnet_1a_cidr = var.private_subnet_1a_cidr
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
  github_secrets_arn         = local.enable_shared_secrets ? module.secrets[0].aws_secrets_arn : "*"
  github_actions_secrets_arn = local.enable_shared_secrets ? module.secrets[0].github_actions_secrets_arn : "*"
  mlflow_basic_auth_arn      = local.enable_shared_secrets ? module.secrets[0].production_secrets_arn : "*"

  enable_github_actions_iam = var.enable_github_actions_iam
}

module "compute" {
  count                = var.enable_compute ? 1 : 0
  source               = "./modules/compute"
  public_subnet_1a_id  = module.network.public_subnet_1a_id
  private_subnet_1a_id = module.network.private_subnet_1a_id
  master_sg_id         = module.security.master_sg_id
  worker_sg_id         = module.security.worker_sg_id
  worker_profile_name  = module.iam[0].worker_profile_name

  key_name              = var.key_name
  master_instance_type  = var.master_instance_type
  master_volume_size    = var.master_volume_size
  worker_instance_count = var.worker_instance_count
  worker_instance_type  = var.worker_instance_type
  worker_volume_size    = var.worker_volume_size
}

module "dns" {
  count       = var.enable_dns ? 1 : 0
  source      = "./modules/dns"
  domain_name = var.domain_name
}

module "alb" {
  count               = local.enable_lb_stack ? 1 : 0
  source              = "./modules/alb"
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = [module.network.public_subnet_1a_id, module.network.public_subnet_1b_id]
  lb_sg_id            = module.security.lb_sg_id
  worker_instance_ids = module.compute[0].worker_instance_ids
  certificate_arn     = module.dns[0].certificate_arn
}
