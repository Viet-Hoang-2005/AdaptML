output "master_public_ip" {
  description = "Public IP for SSH access to Master Node"
  value       = aws_eip.master_eip.public_ip
}

output "worker_instance_ids" {
  description = "List of Worker Instance IDs"
  value       = aws_instance.worker_nodes[*].id
}
