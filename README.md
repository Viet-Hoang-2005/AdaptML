# Hệ thống MLOps: Phát hiện Trôi Dữ liệu và Tái Huấn luyện Tự động cho Mô hình Phát hiện Tấn công Mạng (NIDS)

Dự án này là một quy trình MLOps hoàn chỉnh end-to-end (End-to-End MLOps Pipeline) thiết kế chuyên biệt cho hệ thống Phát hiện Xâm nhập Mạng (Network Intrusion Detection System - NIDS). Đặc điểm nổi bật của hệ thống là khả năng **tự động phát hiện hiện tượng trôi dạt dữ liệu (Data Drift)** khi mạng hứng chịu các kiểu tấn công mới hoặc hành vi tấn công biến đổi, từ đó **tự động kích hoạt luồng tái huấn luyện (Retraining)** và tự động **triển khai mô hình mới không gây downtime (Zero-Downtime Deployment)**.

**Tên Đề tài:** An End-to-End MLOps Architecture for Data Drift Monitoring and Continuous Retraining in Network Intrusion Detection Systems <br>
**Học phần:** NT114: Đồ án Chuyên ngành - Khoa Mạng máy tính và Truyền thông dữ liệu UIT <br>
**Thành viên:** Trần Nguyễn Việt Hoàng (23520541@gm.uit.edu.vn), Bùi Ngọc Thái (23521412@gm.uit.edu.vn)

---

## Tính năng (Core Features)

1. **Phân loại Tấn công:** Sử dụng thuật toán **XGBoost** để phát hiện lưu lượng bình thường (BENIGN) và các loại tấn công (DDoS, PortScan) trích xuất từ tập dữ liệu CIC-IDS2017.
2. **Dự đoán Độ trễ thấp (Low-latency Inference):** API xây dựng bằng **FastAPI** đẩy file mô hình vào RAM để phản hồi siêu tốc.
3. **Lưu vết Bất đồng bộ (Asynchronous Logging):** Mọi request và dự đoán được âm thầm lưu xuống **PostgreSQL** để làm dữ liệu đánh giá mà không chặn luồng chính.
4. **Giám sát Data Drift Tự động:** Một tiến trình ngầm (**CronJob**) dùng thư viện **Evidently AI** thường xuyên phân tích PostgreSQL. Nếu phát hiện trôi dạt (ví dụ bị tấn công theo luồng phân phối lạ), hệ thống gửi lệnh qua **Webhook**.
5. **Kiểm thử Chịu tải (Load & Attack Testing):** Tích hợp **Locust** để giả lập các đợt tấn công DDoS và PortScan cực đoan.
6. **Continuous Training (CT):** Webhook kích hoạt **GitHub Actions** tự động gọi **Kaggle API Compute Engine** để xử lý tập dữ liệu mới và huấn luyện mô hình mạnh mẽ hơn.
7. **Zero-Downtime Continuous Deployment (CD):** Khai thác **K3s (Kubernetes)**: Các API Pods gắn kết với **Init Containers**, tự động kéo cấu hình/weights tối ưu nhất từ kho lưu trữ **AWS S3** khi có bản cập nhật mới.

---

## Cấu trúc Dự án (Project Structure)

```text
MLOps-NIDS-System
├── .github/workflows/          # Github Actions Pipelines (CI / CD / CT Pipeline)
├── api/                        # Chứa FastAPI Server và background tasks lưu vết
│   ├── src/index.py            # API lõi xử lý Machine Learning XGBoost
│   ...
├── data/                       # Dữ liệu phục vụ đánh giá (Reference Data, Validate)
├── infra/                      # Terraform Code tạo hạ tầng (VPC, EC2, S3 trên AWS)
├── k8s/                        # File Manifest định nghĩa các resource cho cụm K3s (Kubernetes)
│   ├── api-deployment.yaml     # Thiết lập chạy API + Init Container lấy model từ S3
│   ├── evidently-cronjob.yaml  # Thiết lập chạy theo lịch cho Evidently AI
│   └── postgres.yaml           # Database và gắn kết Volume
├── kaggle_training/            # Source code và API cấu hình cho quá trình Retrain thực hiện trên Kaggle
├── load_testing/               # Khu vực kiểm thử
│   └── locustfile.py           # Kịch bản giả lập hàng ngàn gói tin tấn công và bình thường
├── models/                     # Kho lưu tự nhiên của model (Sẽ đồng bộ với AWS S3)
├── monitoring/                 
│   ├── detect_drift.py         # Code lõi của Evidently sử dụng DataDriftPreset và gọi Github Webhook
│   └── Dockerfile              # Môi trường chạy cho Evidently CronJob
├── docker-compose.yml          # Dùng chạy môi trường Test Local
└── README.md                   
```

---

## Công nghệ sử dụng (Technology Stack)

| Lớp (Layer)                 | Công nghệ (Technology)                                  |
|-----------------------------|---------------------------------------------------------|
| **Machine Learning**        | XGBoost, Pandas, Scikit-learn                           |
| **Model Serving**           | FastAPI, Uvicorn, Python                                |
| **Data Logging**            | PostgreSQL (Luồng bất đồng bộ - BackgroundTasks)       |
| **Monitoring & Drift**      | Evidently AI (Tự tính toán Report và kích hoạt Webhook)|
| **Simulation / Testing**    | Locust (Network Payload Generator)                      |
| **Compute Engine (Train)**  | Kaggle API, Kaggle Kernel                               |
| **CI / CD / CT Orchestrator**| GitHub Actions                                         |
| **Model Registry**          | AWS S3 (Lưu trữ và phân phối tệp xgb_model.pkl)        |
| **Container & Orchestration**| Docker, K3s (Kubernetes)                              |
| **Infrastructure as Code**  | Terraform (Môi trường AWS)                              |

---

## Luồng Hoạt động Tổng thể (Workflow)

1. **Giai đoạn Vận hành:** User (hoặc Locust) gửi gói tin vào API. Hệ thống FastAPI kiểm tra nội dung và lập tức phản hồi "Benign" hay "DDoS/PortScan", song song đó gọi Background Tasks lưu dữ liệu dạng thô xuống PostgreSQL.
2. **Giai đoạn Cảnh báo:** Đêm hàng ngày (`0 0 * * *`), Pod của Evidently chạy ngầm, so sánh dữ liệu thu hoạch (Production Data) với tập mẫu v1 (Reference Data). Xuất hiện bất thường => Gửi Webhook `repository_dispatch`.
3. **Giai đoạn Tái huấn luyện:** Hành động `data_drift_detected` trong Github CI luân chuyển. Máy chủ điều phối Kaggle chạy Model theo dữ liệu tấn công biến thể => Ép ra bản `xgb_model_v2.pkl`.
4. **Việc Triển khai (Continuous Deployment):** File pkl Version 2 tải lên S3. K3s triển khai *Rolling Updates*. Các Pod tắt lần lượt, Pod mới có Init-Container xin model mới nhất về. Hệ thống thích nghi Tấn Công Mạng theo thời gian thực mà không bị gián đoạn luồng phục vụ. 

---
*Developed for NT114 - MLOps NIDS System Project*
