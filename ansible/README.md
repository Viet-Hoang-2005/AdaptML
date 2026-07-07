# Ansible — K3s Cluster Provisioning

Thư mục `ansible/` chứa các Playbook Ansible để tự động cài đặt và cấu hình **K3s Cluster** trên các EC2 instances được tạo bởi Terraform. Một lệnh duy nhất cài đặt hoàn chỉnh từ OS đến toàn bộ K8s add-ons.

---

## Cấu Trúc Thư Mục

```
ansible/
├── site.yml              # Playbook chính: 4 play theo thứ tự
├── ansible.cfg           # Cấu hình: inventory, SSH key, remote_user=ubuntu
├── inventory/
│   └── terraform.py      # Dynamic inventory: tự động lấy IP từ Terraform outputs
├── group_vars/           # Biến theo nhóm host (master, workers, all)
├── templates/            # Jinja2 templates (config files, unit files)
└── roles/
    ├── common/           # Play 1: OS preparation cho tất cả nodes
    ├── k3s_master/       # Play 2: Cài K3s Server (Master)
    ├── k3s_worker/       # Play 2: Join Workers vào cluster
    ├── helm/             # Play 2 + 4: Cài Helm 3
    └── k8s_addons/       # Play 4: Cài toàn bộ K8s add-ons
```

---

## Playbook Chính (`site.yml`)

4 play chạy tuần tự, có thể chạy độc lập qua tags:

| Play | Hosts | Tag | Mô tả |
|---|---|---|---|
| 1 | `all` | `bootstrap`, `platform` | `common`: OS update, cài curl/git/jq/nfs-common |
| 2 | `master` | `bootstrap` | `k3s_master`: Cài K3s server, setup kubeconfig; `helm`: Cài Helm 3 |
| 3 | `workers` | `bootstrap` | `k3s_worker`: Join worker nodes vào cluster |
| 4 | `master` | `platform` | `helm` + `k8s_addons`: Cài tất cả add-ons |

Các play Bootstrap (1-3) chỉ chạy khi `bootstrap_k3s_cluster = true`.
Play Platform (4) chỉ chạy khi `deploy_k8s_platform = true`.

---

## Roles Chi Tiết

### `common` — OS Preparation (tất cả nodes)
- Update apt packages
- Cài đặt: `curl`, `git`, `jq`, `nfs-common`, `unzip`, `awscli`
- Thiết lập hostname, timezone

### `k3s_master` — K3s Server
- Cài K3s server mode với Traefik disabled (dùng Traefik từ Helm)
- Lưu K3s node token để workers join
- Copy kubeconfig về máy local (`~/.kube/config`)
- Gán node label: `workload-type=control-plane`

### `k3s_worker` — K3s Agent
- Join workers vào cluster qua K3s token từ Master
- SSH ProxyJump qua Master (vì Workers trong Private Subnet)
- Gán node label: `workload-type=worker`

### `helm` — Helm 3
- Cài Helm 3 binary

### `k8s_addons` — K8s Add-ons (cài qua Helm hoặc kubectl apply)

| Add-on | Namespace | Mô tả |
|---|---|---|
| **EBS CSI Driver** | `kube-system` | Dynamic provisioning ổ cứng EBS cho PersistentVolumeClaims |
| **External Secrets Operator** | `external-secrets` | Đồng bộ AWS Secrets Manager → K8s Secrets |
| **KEDA** | `keda` | Event-driven autoscaling, Scale-to-Zero cho model endpoints |
| **ArgoCD** | `argocd` | GitOps pull-based continuous delivery |
| **Argo Workflows** | `argo` | Workflow orchestration cho MLOps pipelines |
| **Argo Events** | `argo-events` | Event-driven trigger (HTTP Webhook → Argo Workflow) |
| **Prometheus + Grafana** | `monitoring` | Cluster metrics, HTTP request monitoring, dashboards |
| **Traefik Ingress** | `kube-system` | API Gateway, dynamic IngressRoute cho model endpoints |

---

## Dynamic Inventory

`inventory/terraform.py` là Python script tự động đọc Terraform outputs để lấy danh sách IP của Master và Workers — không cần cập nhật inventory thủ công khi tạo lại EC2.

---

## Hướng dẫn Chạy

### Yêu cầu
- Python 3.x + `ansible` (`pip install ansible`)
- SSH Key đặt tại `~/.ssh/aws_key` (tương ứng EC2 Key Pair `mlops-keypair`)
- Terraform đã `apply` xong, EC2 instances đang chạy

### Lệnh

```bash
cd ansible/

# Cài K3s cluster đầy đủ (Bootstrap + Platform add-ons)
ansible-playbook site.yml

# Chỉ chạy Bootstrap K3s (không cài add-ons)
ansible-playbook site.yml --tags bootstrap

# Chỉ cài K8s add-ons (cluster đã có sẵn)
ansible-playbook site.yml --tags platform

# Chỉ chạy trên Master
ansible-playbook site.yml --limit master

# Kiểm tra kết nối đến tất cả nodes
ansible all -m ping
```

### Sau khi chạy xong

```bash
# Kubeconfig đã được copy về local
kubectl get nodes

# Kết quả mong đợi:
# NAME           STATUS   ROLES         AGE   VERSION
# ip-10-0-1-61   Ready    master        5m    v1.28.x+k3s1
# ip-10-0-2-193  Ready    <none>        3m    v1.28.x+k3s1
# ip-10-0-2-114  Ready    <none>        3m    v1.28.x+k3s1
```

---

## SSH Access

Workers nằm trong **Private Subnet** — không có Public IP. Phải SSH qua Master làm Jump Host:

```bash
# SSH vào Worker qua ProxyJump
ssh -J ubuntu@<master-public-ip> ubuntu@<worker-private-ip> -i ~/.ssh/aws_key

# Hoặc thêm vào ~/.ssh/config
Host master
  HostName <master-public-ip>
  User ubuntu
  IdentityFile ~/.ssh/aws_key

Host worker1
  HostName <worker-private-ip>
  User ubuntu
  IdentityFile ~/.ssh/aws_key
  ProxyJump master
```
