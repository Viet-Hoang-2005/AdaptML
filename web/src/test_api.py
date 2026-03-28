import os
import pandas as pd
import requests
import time

# 1. CẤU HÌNH ĐƯỜNG DẪN VÀ ENDPOINT
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST_CSV_PATH = os.path.join(ROOT_DIR, 'data', 'test_data.csv')

API_URL = "http://localhost:5000/predict"

def api_test_continuous(samples_per_class=1):
    print(f"🚀 BẮT ĐẦU TEST API INFERENCE LIÊN TỤC...")
    
    # 2. NẠP DỮ LIỆU TEST
    if not os.path.exists(TEST_CSV_PATH):
        print(f"🔎 Không tìm thấy file {TEST_CSV_PATH}. Vui lòng kiểm tra lại đường dẫn!")
        return

    df = pd.read_csv(TEST_CSV_PATH)
    print(f"[+] Đã nạp tập dữ liệu test với {len(df)} dòng.\n")

    try:
        # 3. VÒNG LẶP VÔ HẠN
        while True:
            # Bốc ngẫu nhiên số lượng đều nhau cho mỗi nhãn ở mỗi chu kỳ
            sample_df = df.groupby('Label').sample(n=samples_per_class, random_state=None)
            
            # Xáo trộn dữ liệu đã bốc mẫu 
            sample_df = sample_df.sample(frac=1, random_state=None).reset_index(drop=True)

            # Duyệt qua toàn bộ dữ liệu đã bốc mẫu và gửi từng dòng lên API để kiểm tra dự đoán
            for index, row in sample_df.iterrows():
                print("-" * 50)

                # Tách nhãn thực tế và đặc trưng từ dòng dữ liệu
                actual_label = row['Label']
                features = row.drop('Label').to_dict()

                # payload JSON gửi features lên API
                payload = {
                    "features": features
                }

                print(f"📦 Đang gửi gói tin mạng (Nhãn thực tế: {actual_label})...")
                
                try:
                    # Đo thời gian từ lúc gửi request đến khi nhận được phản hồi để tính độ trễ (latency)
                    start_time = time.time()
                    response = requests.post(API_URL, json=payload)
                    end_time = time.time()
                    
                    latency = round((end_time - start_time) * 1000, 2)

                    # Xử lý phản hồi từ API
                    if response.status_code == 200:
                        # Nhận kết quả dự đoán từ API
                        result = response.json() 
                        predicted_label = result.get('prediction')
                        confidence = result.get('confidence')
                        
                        # So sánh dự đoán với nhãn thực tế để đánh giá đúng/sai
                        status_icon = "✅ ĐÚNG" if predicted_label == actual_label else "❌ SAI"
                        
                        print(f"{status_icon} | Dự đoán: {predicted_label} (Tự tin: {confidence}%) | Độ trễ: {latency}ms")
                        print(f"📊 Chi tiết xác suất: {result.get('probabilities')}")
                    else:
                        print(f"⚠️ API báo lỗi (Status {response.status_code}): {response.text}")

                except requests.exceptions.ConnectionError:
                    print("⚠️ Lỗi kết nối: API chưa được bật!")
                    return
                    
                time.sleep(2) # Nghỉ 2 giây giữa các lần bắn request

    except KeyboardInterrupt:
        print("\nKẾT THÚC LUỒNG TEST API!")

if __name__ == "__main__":
    api_test_continuous(samples_per_class=1)