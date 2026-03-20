```bash
mlops-weather-system/
├── .github/workflows/          # Thư mục cho AWS CodePipeline / GitLab CI
│   ├── ci_cd_pipeline.yml      # Tự động build Docker image và push lên Amazon ECR
│   └── retrain_pipeline.yml    # Pipeline chạy khi có cảnh báo Data Drift
│
├── infra/                      # Infrastructure as Code (Terraform hoặc AWS CDK)
│   ├── main.tf                 # Định nghĩa các tài nguyên AWS (S3, ECR, Lambda, SageMaker...)
│   └── variables.tf
│
├── src/
│   ├── api/                    # Dịch vụ Inference (API dự đoán)
│   │   ├── Dockerfile
│   │   ├── index.py              # Flask API
│   │   └── requirements.txt
│   │
│   ├── drift_detection/        # Service kiểm tra Data Drift
│   │   ├── Dockerfile
│   │   ├── detect_drift.py     # Script so sánh data thực tế (production) và data gốc (reference)
│   │   └── requirements.txt    # Sử dụng thư viện EvidentlyAI
│   │
│   └── training/               # Service Training & Retrain
│       ├── Dockerfile
│       ├── train.py            # Chứa logic train XGBoost model
│       └── requirements.txt
│
├── data/                       # Cấu trúc map với Amazon S3 Buckets
│   ├── reference_data.csv      # Data chuẩn dùng để train model hiện tại
│   └── production_data.csv     # Data thực tế thu thập từ API (lưu log)
│
├── models/                     # Map với S3 Bucket chứa model artifacts (Model Registry)
│   ├── label_encoder.pkl
│   └── xgb_best_model.pkl
│
├── .dockerignore
├── .gitignore
├── docker-compose.yml          # Dùng để chạy thử và test giao tiếp giữa các service ở local
└── README.md
```