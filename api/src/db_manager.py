import os
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# 1. NẠP BIẾN MÔI TRƯỜNG
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_PATH = os.path.join(ROOT_DIR, '.env')
load_dotenv(dotenv_path=ENV_PATH)

# Biến cấu hình DB với giá trị mặc định nếu không có trong .env
DB_USER = os.getenv("DB_USER", "admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "secret")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_nids_db")


# 2. KHỞI TẠO KẾT NỐI (GLOBAL CONNECTION POOL)
try:
    # Tạo URL kết nối PostgreSQL từ biến môi trường
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

    # Tạo engine với connection pooling để mở sẵn 10 đường truyền và tối đa 20 đường khi tải quá nặng
    engine = create_engine(db_url, pool_size=10, max_overflow=20)
    print("🔗 Successfully connected to the PostgreSQL database with Connection Pooling!")
except Exception as e:
    print(f"⛓️‍💥 Database connection failed: {e}")
    engine = None


# 3. HÀM LƯU DATAFRAME VÀO DATABASE
def save_dataframe_to_db(df: pd.DataFrame, table_name: str):
    if engine is None:
        print("❌ No database engine available.")
        return False
    
    try:
        # Chia nhỏ Dataframe thành các chunk và chèn thêm dữ liệu vào cuối thay vì ghi đè
        df.to_sql(table_name, engine, if_exists='append', index=False, chunksize=1000)
        
        # Nếu DataFrame có cột 'id', kiểm tra và thêm PRIMARY KEY nếu cần
        if 'id' in df.columns:
            with engine.begin() as conn:
                # Truy vấn từ biền metadata gốc của PostgreSQL xem bảng này đã có khóa chính chưa
                check_pk_query = text(f"""
                    SELECT constraint_name
                    FROM information_schema.table_constraints
                    WHERE table_name = '{table_name}' AND constraint_type = 'PRIMARY KEY';
                """)
                # Nếu chưa có PK, thêm PK trên cột `id`
                result = conn.execute(check_pk_query).fetchone()
                if not result:
                    try:
                        # ALTER TABLE để thêm PK trên cột `id`
                        conn.execute(text(f'ALTER TABLE "{table_name}" ADD PRIMARY KEY (id);'))
                        print(f"🔑 Successfully added Primary Key to '{table_name}'")
                    except Exception as pk_err:
                        # Nếu không thể thêm PK (ví dụ vì dữ liệu trùng id), in cảnh báo
                        print(f"⚠️ Could not set Primary Key: {pk_err}")

        # Thông báo số bản ghi đã chèn để theo dõi
        record_count = len(df)
        if record_count == 1 and 'id' in df.columns:
            print(f"✅ Successfully inserted 1 record (ID: {df['id'].iloc[0]}) into '{table_name}'")
        else:
            print(f"✅ Successfully inserted {record_count} records into '{table_name}'")
        return True
    except Exception as e:
        print(f"❌ Error saving data to database: {e}")
        return False


# 4. TEST CHẠY THỬ ĐỘC LẬP
if __name__ == "__main__":
    import uuid
    from datetime import datetime
    
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    CSV_PATH = os.path.join(ROOT_DIR, 'data', 'test_data.csv')
    
    if os.path.exists(CSV_PATH):
        print(f"[+] Reading Reference Data from: {CSV_PATH}")
        sample_df = pd.read_csv(CSV_PATH)
        
        # Nếu không có cột `id`, tạo UUID cho mỗi dòng
        if 'id' not in sample_df.columns:
            sample_df['id'] = [str(uuid.uuid4()) for _ in range(len(sample_df))]
        # Thêm timestamp tạo bản ghi nếu thiếu
        if 'created_at' not in sample_df.columns:
            sample_df['created_at'] = datetime.utcnow()
        
        print("✅ Test Data upload complete!")
        save_dataframe_to_db(sample_df, "nids_reference_data")
    else:
        print("❌ Test CSV file not found! Please check the path.")