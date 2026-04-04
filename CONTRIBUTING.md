# Hướng dẫn Đóng góp (Contributing Guide)

Tài liệu này cung cấp các nguyên tắc và hướng dẫn để tham gia đóng góp mã nguồn vào dự án **Hệ thống MLOps Phát hiện Xâm nhập Mạng (NIDS)**.

---

## Nhóm Tác giả (Team)

| Họ Tên                 | Email                  | Phụ trách chính                                             |
| ---------------------- | ---------------------- | ----------------------------------------------------------- |
| Trần Nguyễn Việt Hoàng | 23520541@gm.uit.edu.vn | MLOps Architecture, FastAPI, Drift Detection (Evidently AI) |
| Bùi Ngọc Thái          | 23521412@gm.uit.edu.vn | K3s Operations, Infrastructure (Terraform, AWS), CI/CD      |

---

## Bắt đầu Đóng góp (Getting Started)

1. Fork kho lưu trữ (repository) này
2. Tạo một nhánh tính năng (feature branch): `git checkout -b feature/new-function`
3. Thực hiện và lưu lại các thay đổi (commit)
4. Chạy kiểm thử nội bộ: (Sử dụng công cụ Unit Test hoặc Locust nếu liên quan đến API)
5. Ghi nhận thay đổi bằng Commit Message: `git commit -m "feat(scope): description of the change"`
6. Đẩy nhánh lên Remote: `git push -u origin feature/new-function`
7. Tạo Yêu cầu Kéo (Pull Request - PR) trên Github

---

## Tiêu chuẩn Đặt tên Nhánh (Branch Naming)

```text
feature/add-locust-script
fix/error-connect-postgresql
docs/update-readme
chore/upgrade-library-version
```

---

## Tiêu chuẩn Commit Messages

```text
feat(api): them tinh nang luu log du doan

- Ghi nhan timestamp, feature mang, nhan du doan
- Đang luu xuong PostgreSQL bang BackgroundTasks

Closes #42
```

Các loại tiền tố (Types): `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

---

## Danh sách Kiểm tra trước khi Pull Request (PR Checklist)

- [ ] Code tuân thủ các nguyên tắc thiết kế chung của PEP 8.
- [ ] Môi trường Docker / K3s có thể khởi chạy bình thường.
- [ ] Nhánh tính năng đã được đồng bộ với nhánh `main`.
- [ ] Bổ sung/Cập nhật tài liệu (nếu có tính năng mới).

_Vui lòng xem file mẫu [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)._

---

## Tiêu chuẩn Mã nguồn (Code Standards)

- Tuân thủ chuẩn lập trình **PEP 8** đối với Python.
- Thêm **Type hints** (vd: `payload: Dict[str, float]`) để code dễ dự đoán.
- Viết **docstrings** đầy đủ cho các khối hàm phức tạp (vd: `detect_drift.py`).
- Xoá hoặc vô hiệu hoá các lệnh in log thừa (như `print()` hay `console.log`) trước khi lên Production.

---

## Kiểm thử (Testing)

Khi đóng góp mã nguồn mới liên quan đến Model hay kiến trúc, khuyến nghị chạy giả lập mạng:

```bash
# Gửi gói tin thử nghiệm
locust -f load_testing/locustfile.py --host=http://localhost:5000
```

Đảm bảo API không bị tràn bộ nhớ hoặc rớt kết nối.

---

## Báo lỗi & Yêu cầu Tính năng (Issues)

- Báo cáo Bug: [.github/ISSUE_TEMPLATE/ISSUE_BUG.md](.github/ISSUE_TEMPLATE/ISSUE_BUG.md)
- Yêu cầu chức năng: [.github/ISSUE_TEMPLATE/ISSUE_FEATURE.md](.github/ISSUE_TEMPLATE/ISSUE_FEATURE.md)

---

## Câu hỏi & Trao đổi

Liên hệ trực tiếp qua Email: **23520541@gm.uit.edu.vn** hoặc **23521412@gm.uit.edu.vn**

---

*Created for MLOps NIDS System Project*
