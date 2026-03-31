import os
import pandas as pd
from locust import HttpUser, task, between, events

# 1. CẤU HÌNH VÀ NẠP DỮ LIỆU TOÀN CỤC
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
    data_records = df.to_dict('records')
    # Đảo ngược list để hàm pop() rút dữ liệu từ trên xuống dưới (O(1))
    data_records.reverse() 
    print(f"✅ Đã nạp thành công {len(data_records)} dòng dữ liệu Test cho Locust.")
except Exception as e:
    print(f"❌ Lỗi nạp data: {e}")
    data_records = []

# 2. ĐỊNH NGHĨA KỊCH BẢN NGƯỜI DÙNG ẢO
class NIDSTestUser(HttpUser):
    # Thời gian nghỉ ngẫu nhiên giữa các lần bắn request của 1 user
    wait_time = between(0.1, 0.5) 

    @task
    def predict_traffic(self):
        # Rút từng dòng dữ liệu ra khỏi list
        try:
            row = data_records.pop()
        except IndexError:
            # Nếu list rỗng (đã duyệt hết file) thì ra lệnh cho Locust tự động dừng
            self.environment.runner.quit()
            return

        actual_label = row['Label']

        # Đóng gói payload
        features = {k: v for k, v in row.items() if k != 'Label'}
        payload = {"features": features}

        # Bắn request
        with self.client.post("/predict", json=payload, catch_response=True) as response:
            if response.status_code == 200:
                result = response.json()
                predicted_label = result.get("prediction")

                if predicted_label == actual_label:
                    prediction_stats[actual_label]['correct'] += 1
                    response.success()
                else:
                    prediction_stats[actual_label]['wrong'] += 1
                    response.failure(f"Sai: Thực tế {actual_label} - Đoán {predicted_label}")
            else:
                response.failure(f"Lỗi Server: HTTP {response.status_code}")

# 3. EVENT HOOK: IN BÁO CÁO KHI DỪNG TEST
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