variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used as a prefix for resource names/tags"
  type        = string
  default     = "fincard"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for the public subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "availability_zones" {
  description = "Availability zones to spread subnets across"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "db_name" {
  description = "Name of the initial Postgres database"
  type        = string
  default     = "fincard"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "fincard"
  sensitive   = true
}

variable "db_password" {
  description = "Master password for the RDS instance"
  type        = string
  sensitive   = true
}

variable "s3_bucket_name" {
  description = "Name of the S3 bucket used as the transactions data lake"
  type        = string
  default     = "fincard-transactions"
}

variable "glue_database" {
  description = "Glue Data Catalog database name"
  type        = string
  default     = "fincard_loyalty"
}

variable "glue_table" {
  description = "Glue Data Catalog table name"
  type        = string
  default     = "transactions"
}

variable "container_port" {
  description = "Port the app container listens on"
  type        = number
  default     = 3000
}

variable "app_image_tag" {
  description = "Docker image tag to deploy from ECR"
  type        = string
  default     = "latest"
}

variable "desired_count" {
  description = "Desired number of ECS Fargate tasks"
  type        = number
  default     = 1
}
