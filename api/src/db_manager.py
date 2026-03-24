import os
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine

# 1. NẠP BIẾN MÔI TRƯỜNG
load_dotenv()

DB_USER = os.getenv("DB_USER", "admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "secret")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_weather_db")

# 2. KHỞI TẠO KẾT NỐI (ENGINE)
def get_db_engine():
    try:
        # Chuỗi kết nối của PostgreSQL
        db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        engine = create_engine(db_url)
        print("🔗 Successfully connected to the PostgreSQL database!")
        return engine
    except Exception as e:
        print(f"⛓️‍💥 Database connection failed: {e}")
        return None

# 3. HÀM LƯU DATAFRAME VÀO DATABASE
def save_dataframe_to_db(df: pd.DataFrame, table_name: str):
    engine = get_db_engine()
    if engine is None:
        return False
    
    try:
        print(f"[+] Attempting to save {len(df)} records to table '{table_name}'...")
        
        # Dùng hàm to_sql của Pandas để đẩy dữ liệu vào PostgreSQL
        df.to_sql(table_name, engine, if_exists='append', index=False)
        
        print(f"✅ Data successfully saved to table '{table_name}'.")
        return True
    except Exception as e:
        print(f"❌ Error saving data to database: {e}")
        return False

# 4. TEST CHẠY THỬ ĐỘC LẬP
if __name__ == "__main__":
    # Test thử bằng cách đọc file CSV đang có và đẩy lên DB
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    CSV_PATH = os.path.join(ROOT_DIR, 'data', 'reference_data.csv')
    
    if os.path.exists(CSV_PATH):
        print(f"[+] Reading Reference Data from: {CSV_PATH}")
        sample_df = pd.read_csv(CSV_PATH)
        
        # Gọi hàm lưu vào bảng tên là 'reference_features'
        save_dataframe_to_db(sample_df, "reference_features")
    else:
        print("[-] Test CSV file not found. Please check the path.")