import os
import random
import pandas as pd
from locust import HttpUser, task, between, events

# --- 1. CẤU HÌNH VÀ NẠP DỮ LIỆU TOÀN CỤC ---
# Nạp dữ liệu 1 lần duy nhất khi khởi động script để tối ưu RAM
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST_CSV_PATH = os.path.join(ROOT_DIR, 'data', 'test_data.csv')

# Từ điển (Dictionary) theo dõi thống kê kết quả dự đoán
prediction_stats = {
    'BENIGN': {'correct': 0, 'wrong': 0},
    'DDoS': {'correct': 0, 'wrong': 0},
    'PortScan': {'correct': 0, 'wrong': 0},
    'BruteForce': {'correct': 0, 'wrong': 0},
    'WebAttacks': {'correct': 0, 'wrong': 0}
}

try:
    df = pd.read_csv(TEST_CSV_PATH)
    # Chuyển DataFrame thành list of dicts để truy xuất ngẫu nhiên O(1) cực nhanh
    data_records = df.to_dict('records')
    print(f"✅ Đã nạp thành công {len(data_records)} dòng dữ liệu Test cho Locust.")
except Exception as e:
    print(f"❌ Lỗi nạp data: {e}")
    data_records = []

# --- 2. ĐỊNH NGHĨA KỊCH BẢN NGƯỜI DÙNG ẢO ---
class NIDSTestUser(HttpUser):
    # Thời gian nghỉ ngẫu nhiên giữa các lần bắn request của 1 user (0.1s đến 0.5s)
    wait_time = between(0.1, 0.5) 

    @task
    def predict_traffic(self):
        if not data_records:
            return

        # Bốc ngẫu nhiên 1 dòng dữ liệu
        row = random.choice(data_records)
        actual_label = row['Label']

        # Đóng gói payload loại bỏ cột Label
        features = {k: v for k, v in row.items() if k != 'Label'}
        payload = {"features": features}

        # Bắn POST request đến API và bắt lấy response
        with self.client.post("/predict", json=payload, catch_response=True) as response:
            if response.status_code == 200:
                result = response.json()
                predicted_label = result.get("prediction")

                # Cập nhật thống kê và báo cáo cho Locust UI
                if predicted_label == actual_label:
                    prediction_stats[actual_label]['correct'] += 1
                    response.success()
                else:
                    prediction_stats[actual_label]['wrong'] += 1
                    response.failure(f"Sai: Thực tế {actual_label} - Đoán {predicted_label}")
            else:
                response.failure(f"Lỗi Server: HTTP {response.status_code}")

# --- 3. EVENT HOOK: IN BÁO CÁO KHI DỪNG TEST ---
@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    print("\n" + "="*60)
    print("📊 TỔNG KẾT KẾT QUẢ DỰ ĐOÁN TỪ MÔ HÌNH XGBOOST")
    print("="*60)
    
    total_correct = 0
    total_wrong = 0
    
    for label, counts in prediction_stats.items():
        total_class = counts['correct'] + counts['wrong']
        total_correct += counts['correct']
        total_wrong += counts['wrong']
        
        if total_class > 0:
            accuracy = (counts['correct'] / total_class) * 100
            print(f"🔹 {label:<15} | Tổng: {total_class:<5} | Đúng: {counts['correct']:<4} | Sai: {counts['wrong']:<4} | Accuracy: {accuracy:.2f}%")
        else:
            print(f"🔹 {label:<15} | Chưa có dữ liệu đi qua API.")
            
    total_requests = total_correct + total_wrong
    if total_requests > 0:
        overall_accuracy = (total_correct / total_requests) * 100
        print("-" * 60)
        print(f"🏆 ĐỘ CHÍNH XÁC TỔNG THỂ (OVERALL ACCURACY): {overall_accuracy:.2f}%")
    print("="*60 + "\n")