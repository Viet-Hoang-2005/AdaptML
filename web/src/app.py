# app.py: Hiện tại chưa sử dụng
import gradio as gr
import requests
import json

# Cấu hình địa chỉ API
API_URL = "http://127.0.0.1:5000/predict"

def predict_weather(image_path):
    if image_path is None:
        return "Please upload a photo!"
    
    try:
        # 1. Đọc file ảnh dưới dạng binary và gửi POST request tới API
        with open(image_path, 'rb') as img_file:
            files = {'image': img_file}
            response = requests.post(API_URL, files=files)
        
        # 2. Xử lý phản hồi từ API
        if response.status_code == 200:
            data = response.json()
            
            if data.get("success"):
                predictions = data.get("predictions", {})

                # Tìm nhãn có xác suất cao nhất
                best_label = max(predictions, key=predictions.get)
                    
                return best_label
            else:
                return f"API Error: {data.get('error')}"
        else:
            try:
                # FastAPI sử dụng key "detail" cho các HTTPException
                error_detail = response.json().get("detail", "Unknown error from server")
                return f"Server Error {response.status_code}: {error_detail}"
            except ValueError:
                return f"Server Error (Status code: {response.status_code})"
            
    except Exception as e:
        return f"An unknown Error: {str(e)}"

# Giao diện chính
iface = gr.Interface(
    fn=predict_weather,
    inputs=gr.Image(type="filepath", label="Upload weather photos"),
    outputs=gr.Textbox(label="Results:"),
    title="NT114 - MLOps system for Weather Classification Models",
    show_progress="hidden",
    flagging_mode="never"
)

if __name__ == "__main__":
    iface.launch()