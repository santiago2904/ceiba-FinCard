output "alb_dns_name" {
  description = "Public DNS name of the ALB fronting the FinCard service"
  value       = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  description = "URI of the ECR repository to push the app image to"
  value       = aws_ecr_repository.app.repository_url
}
