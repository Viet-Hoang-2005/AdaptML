output "lb_sg_id" {
  description = "ID of the load balancer security group"
  value       = aws_security_group.lb_sg.id
}

output "master_sg_id" {
  description = "ID of the master node security group"
  value       = aws_security_group.master_sg.id
}

output "worker_sg_id" {
  description = "ID of the worker node security group"
  value       = aws_security_group.worker_sg.id
}
