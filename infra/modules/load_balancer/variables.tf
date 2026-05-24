variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "lb_sg_id" {
  type = string
}

variable "worker_instance_ids" {
  type = list(string)
}

variable "certificate_arn" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "domain_name" {
  type = string
}
