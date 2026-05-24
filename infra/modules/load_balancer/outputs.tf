output "lb_dns_name" {
  description = "DNS name of the Load Balancer"
  value       = aws_lb.api_alb.dns_name
}
