# Infrastructure as Code — Terraform (AWS)

Thư mục `infra/` chứa toàn bộ mã **Infrastructure as Code (IaC)** viết bằng Terraform để tự động hóa triển khai hạ tầng AWS cho nền tảng AI PaaS. Kiến trúc được thiết kế theo dạng **module hóa** với các feature flag để bật/tắt từng thành phần độc lập.

---

## Cấu Trúc Thư Mục

```
infra/
├── main.tf          # Module composition: gọi từng module theo feature flag
├── variables.tf     # Biến toàn cục: region, VPC CIDR, instance types, feature flags
├── outputs.tf       # Output: public IPs, ALB DNS, S3 bucket name, IAM roles
├── provider.tf      # AWS provider, Terraform version constraints
└── modules/
    ├── network/     # VPC, Subnets, Internet Gateway, NAT Gateway, Route Tables
    ├── compute/     # EC2 Master + Workers (K3s cluster), IAM Instance Profile
    ├── security/    # Security Groups: master_sg, worker_sg, lb_sg
    ├── iam/         # IAM Roles + Policies: EC2 Instance Profile, Karpenter, GitHub Actions OIDC
    ├── storage/     # S3 Buckets: mlops-paas-artifacts (model artifacts, training data, drift reports)
    ├── alb/         # Application Load Balancer, Listener, Target Group
    ├── dns/         # Route53 Hosted Zone, A Record, ACM Certificate (HTTPS)
    └── secrets/     # AWS Secrets Manager: 3 secret resources
```

---

## Feature Flags (variables.tf)

Mỗi module có thể bật/tắt độc lập qua `terraform.tfvars`:

| Variable | Default | Mô tả |
|---|---|---|
| `enable_compute` | `true` | EC2 Master + Worker nodes |
| `enable_alb` | `true` | Application Load Balancer |
| `enable_dns` | `true` | Route53 + ACM Certificate |
| `enable_nat_gateway` | `true` | NAT Gateway cho Private Subnet |
| `enable_karpenter` | `true` | IAM + discovery tags cho Karpenter |
| `enable_github_actions_iam` | `true` | OIDC Provider cho GitHub Actions |
| `enable_secrets_manager` | `true` | AWS Secrets Manager resources |

---

## Hạ tầng được tạo ra

### Network (`modules/network/`)
- **VPC**: `10.0.0.0/16`
- **Public Subnet 1a** (`10.0.1.0/24`): Master Node + NAT Gateway
- **Public Subnet 1b** (`10.0.3.0/24`): ALB (Multi-AZ)
- **Private Subnet 1a** (`10.0.2.0/24`): Worker Nodes
- Internet Gateway + Route Tables

### Compute (`modules/compute/`)
- **K3s Master**: `t3.medium`, 40GB EBS, Public Subnet 1a
- **K3s Workers**: `t3.large` × 2, 40GB EBS, Private Subnet 1a
- IAM Instance Profile gắn vào tất cả nodes (quyền S3, Secrets Manager, EBS CSI)

### Security (`modules/security/`)
- `master_sg`: Port 6443 (K8s API), 22 (SSH)
- `worker_sg`: Port 80/443 (Traefik), inter-node communication
- `lb_sg`: Port 80/443 từ Internet

### IAM (`modules/iam/`)
- **EC2 Instance Profile** (`mlops-ec2-node-profile`): Quyền S3 full access, Secrets Manager read
- **Karpenter Controller Role**: Quyền tạo/xóa EC2 instances, describe launch templates
- **Karpenter Node Profile** (`mlops-karpenter-node-profile`): Profile cho EC2 nodes do Karpenter tạo; quyền read `mlops/k3s-agent-token` để tự động join K3s cluster
- **GitHub Actions OIDC**: Cho phép GitHub Actions Assume Role → deploy secrets, không cần Access Key tĩnh
- **SQS + EventBridge**: Interruption queue để Karpenter nhận Spot termination events

### Storage (`modules/storage/`)
S3 Bucket `mlops-paas-artifacts`:
```
mlops-paas-artifacts/
├── user-models/{tenant_id}/{model_id}/    # Model artifact ZIPs (upload từ Tenant)
├── training-data/                          # Training datasets
├── training-artifacts/{job_id}/            # model.tar.gz output từ Training Runner
├── drift-reports/{job_id}/                 # HTML + JSON drift reports từ Evidently
└── users/{tenant_id}/models/{hashid}/...  # MLflow artifact store
```

### ALB (`modules/alb/`)
- ALB `mlops-api-lb` → Target Group → Worker Port 80 (Traefik Ingress)

### DNS (`modules/dns/`)
- Route53 Hosted Zone cho domain `mlops-nids-nt114.id.vn`
- ACM Certificate (HTTPS) + DNS validation

### Secrets Manager (`modules/secrets/`)
Ba kho secret (trống khi tạo, được điền bởi `scripts/push_secrets_to_aws.py`):

| Secret Name | Dùng cho |
|---|---|
| `mlops/aws-secrets` | AWS Credentials (local dev) |
| `mlops/github-actions-secrets` | Harbor Robot Account, Cosign Keys |
| `mlops/production-secrets` | DB, JWT, OAuth, Harbor, Webhook, HARBOR_DOCKERCONFIG |

---

## Hướng dẫn Triển khai

### Yêu cầu
- `terraform >= 1.5`
- `aws-cli` đã cấu hình (`aws configure` hoặc IAM Role)
- EC2 Key Pair tên `mlops-keypair` đã tạo sẵn trên AWS

### Các lệnh

```bash
cd infra/

# 1. Khởi tạo providers và modules
terraform init

# 2. (Tùy chọn) Tạo file cấu hình
cat > terraform.tfvars << EOF
aws_region            = "ap-southeast-1"
master_instance_type  = "t3.medium"
worker_instance_type  = "t3.large"
worker_instance_count = 2
enable_karpenter      = true
EOF

# 3. Xem trước thay đổi
terraform plan

# 4. Triển khai
terraform apply

# 5. Lấy Public IP của Master để cấu hình Ansible inventory
terraform output
```

### Hủy hạ tầng (tiết kiệm chi phí)

```bash
terraform destroy
```

> **Lưu ý**: `enable_secrets_manager = true` mặc định để tránh xóa nhầm secrets đang được sử dụng bởi ESO và CI/CD.

---

## Bảo mật

- **KHÔNG commit** `.tfstate` lên Git (đã có trong `.gitignore`). File này chứa thông tin nhạy cảm về hạ tầng thực tế.
- Secrets không được hardcode trong Terraform — chỉ tạo resource Secrets Manager rỗng; nội dung được đẩy qua `scripts/push_secrets_to_aws.py`.
- EC2 nodes dùng IAM Instance Profile thay vì Access Key tĩnh.
