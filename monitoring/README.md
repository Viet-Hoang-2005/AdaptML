# Monitoring

Thư mục này chứa logic phát hiện drift và image runtime cho Evidently.

- `detect_drift.py`: đọc reference data và production data, tính drift và gửi alert event.
- `Dockerfile`: image dùng cho drift job trên K8s.
- `requirements.txt`: dependencies cho phần monitoring.

Ở Phase 1, thư mục này chỉ có nhiệm vụ cảnh báo, không được tự khởi động retrain.
