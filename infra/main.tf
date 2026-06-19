module "network" {
  source = "./modules/network"
}

module "security" {
  source = "./modules/security"
  vpc_id = module.network.vpc_id
}

module "storage" {
  source = "./modules/storage"
}

module "secrets" {
  source = "./modules/secrets"
}

module "iam" {
  source                     = "./modules/iam"
  artifacts_bucket_arn       = module.storage.bucket_arn
  github_secrets_arn         = module.secrets.github_secrets_arn
  github_actions_secrets_arn = module.secrets.github_actions_secrets_arn
  mlflow_basic_auth_arn      = module.secrets.mlflow_basic_auth_arn
}

module "compute" {
  source               = "./modules/compute"
  public_subnet_1a_id  = module.network.public_subnet_1a_id
  private_subnet_1a_id = module.network.private_subnet_1a_id
  master_sg_id         = module.security.master_sg_id
  worker_sg_id         = module.security.worker_sg_id
  worker_profile_name  = module.iam.worker_profile_name
}

module "dns" {
  source = "./modules/dns"
}

module "alb" {
  source              = "./modules/alb"
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = [module.network.public_subnet_1a_id, module.network.public_subnet_1b_id]
  lb_sg_id            = module.security.lb_sg_id
  worker_instance_ids = module.compute.worker_instance_ids
  certificate_arn     = module.dns.certificate_arn
  zone_id             = module.dns.zone_id
  domain_name         = "api.mlops-nids-nt114.id.vn"
}

module "serverless" {
  source               = "./modules/serverless"
  lambda_exec_role_arn = module.iam.lambda_exec_role_arn
  artifacts_bucket_id  = module.storage.bucket_id
  artifacts_bucket_arn = module.storage.bucket_arn
}
