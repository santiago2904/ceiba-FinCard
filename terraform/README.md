# FinCard — Terraform (AWS)

Provisions the AWS infrastructure for the FinCard loyalty-settlement service:

- VPC with 2 public + 2 private subnets across 2 AZs, IGW, single NAT gateway, route tables.
- ECR repository for the app image.
- S3 bucket `fincard-transactions` (versioned, encrypted, private).
- RDS Postgres 16 (`db.t3.micro`) in the private subnets, master credentials + connection
  string stored in Secrets Manager.
- ECS Fargate cluster/service running the app container (port 3000), fronted by an ALB
  (listener on `:80`, target group health check on `/health`).
- Least-privilege IAM: task execution role (ECR pull, logs, read the DB secret) and task
  role (S3 bucket access + Glue Data Catalog access) are separate roles.
- Security groups: ALB `:80` open to the internet; app `:3000` only from the ALB SG; RDS
  `:5432` only from the app SG.

## Prerequisites

- Terraform >= 1.5
- AWS credentials configured (`aws configure` / SSO) with permission to create the
  resources above.
- Docker, to build and push the app image.

## Deploy steps

1. **Set required variables.** At minimum you must supply a DB password (marked
   `sensitive`, no default). Either export a `TF_VAR_db_password` env var or create a
   `terraform.tfvars` (gitignored) with:

   ```hcl
   db_password = "<a-strong-password>"
   ```

2. **Provision the infrastructure:**

   ```bash
   cd terraform
   terraform init
   terraform apply
   ```

   This creates the VPC, ECR repo, S3 bucket, RDS instance, and an ECS service. The
   very first `apply` will deploy the ECS task using the `latest` tag, which does not
   exist yet in ECR — the service will show unhealthy tasks until step 3 completes.

3. **Build and push the app image to ECR:**

   ```bash
   ECR_URL=$(terraform output -raw ecr_repository_url)
   aws ecr get-login-password --region us-east-1 \
     | docker login --username AWS --password-stdin "${ECR_URL%/*}"

   docker build -t "$ECR_URL:latest" ..
   docker push "$ECR_URL:latest"
   ```

4. **Force a new ECS deployment** so the service picks up the freshly pushed image:

   ```bash
   aws ecs update-service \
     --cluster fincard-cluster \
     --service fincard-app \
     --force-new-deployment
   ```

5. **Verify the deployment:**

   ```bash
   curl "http://$(terraform output -raw alb_dns_name)/health"
   ```

   Put the resulting ALB URL into the root [`README.md`](../README.md) once it's live.

## Outputs

| Output               | Description                                  |
|----------------------|-----------------------------------------------|
| `alb_dns_name`        | Public DNS name of the ALB — the deployed URL |
| `ecr_repository_url`  | ECR repository URI to push the app image to  |

## Notes

- `terraform.tfvars` and any file containing secrets must never be committed — see the
  repo's `.gitignore`.
- The NAT gateway and RDS instance incur ongoing AWS costs; run `terraform destroy` when
  the environment is no longer needed.
