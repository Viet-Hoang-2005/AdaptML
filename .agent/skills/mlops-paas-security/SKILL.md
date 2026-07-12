---
name: mlops-paas-security
description: "Bảo mật hiện tại của MLOps PaaS: tenant-scoped UUID API, JWT RS256/JWKS, project API key, internal webhook secret, S3 presigned URL, Kaniko, IAM và External Secrets. Dùng khi thay đổi auth, permissions, callback hoặc secret/infrastructure access."
---

# Security và Tenant Isolation

Đọc `common/api/permissions.py`, `apps/auth/`, `apps/access/`, selectors của domain liên quan, `services/model-server/src/` và `k8s/secrets/` trước khi thay đổi.

## Identity và inference access

- Control Plane phát access/refresh token RS256 tại `/api/auth/token/` và expose JWKS tại `/api/auth/.well-known/jwks.json`.
- Gateway verify signature, `kid`, audience `mlops-paas` và `tenant_id` trước khi route worker.
- Public model có thể không cần credential. Private model yêu cầu Bearer JWT hoặc `X-API-Key` active và scope được project owner chấp nhận.
- `UserAPIKey` chỉ lưu hash; secret chỉ trả một lần khi create/regenerate.

Đừng đặt model ID vào JWT như một authorization shortcut. Resolve version/project và enforce tenant/API-key scope ở gateway + tenant-scoped Control Plane query.

## API và callback boundary

1. Public resource URL dùng UUID `public_id`; integer PK là internal-only.
2. Selector phải scope tenant/user trước mọi retrieve/update/delete.
3. Internal callback dùng `X-Control-Plane-Secret` hoặc `Authorization: Bearer <secret>`; permission so sánh constant-time.
4. Dùng `Idempotency-Key` khi source callback có thể retry; không ghi đè terminal state.
5. Dùng presigned S3 GET/PUT URL với TTL giới hạn cho runner/worker thay vì truyền AWS secret cho user workload.

## Secrets và workload credentials

- Local có thể lấy AWS/Harbor/test credential từ `.env`; không log hoặc commit giá trị.
- Production dùng EC2 IAM role và External Secrets Operator từ AWS Secrets Manager.
- K8s secrets quan trọng: `mlops-paas-secret`, `harbor-registry-secret`, `harbor-registry-dockerconfig`, pull secret trong `user-jobs`.
- Không đọc `.env` để hiển thị, copy vào issue, test output hay tài liệu.

## Build và runtime hardening

- Local Docker build có Docker socket mount vì đó là development adapter; không đưa mount này vào K8s workload.
- Production build dùng Kaniko và dockerconfig secret trong `/kaniko/.docker/`.
- Training runner chỉ extract ZIP sau khi chặn path traversal và chỉ download/upload bằng presigned HTTP(S) URL.
- Worker runtime nằm sau gateway; không tạo public ingress riêng cho model.

## Checklist thay đổi nhạy cảm

- Viết test tenant A không thể đọc/ghi resource tenant B.
- Test API key chỉ scope project cùng owner.
- Test missing/invalid callback secret trả 403/401 phù hợp.
- Không thêm secret, token, private key hoặc presigned URL vào source, log hoặc fixture.
- Kiểm tra NetworkPolicy/RBAC/IAM scope khi thêm K8s resource hay AWS action.
