import os
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

KEYS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'keys')
PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, 'private_key.pem')
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, 'public_key.pem')

def generate_or_load_keys():
    """Tự động load cặp khóa RSA từ biến môi trường (K3s), hoặc sinh ra file local nếu chạy dev."""
    env_priv = os.environ.get("JWT_PRIVATE_KEY")
    env_pub = os.environ.get("JWT_PUBLIC_KEY")
    if env_priv and env_pub:
        # Xử lý trường hợp chuỗi PEM trong biến môi trường bị thoát ký tự xuống dòng (\n)
        priv_bytes = env_priv.replace("\\n", "\n").encode("utf-8")
        pub_bytes = env_pub.replace("\\n", "\n").encode("utf-8")
        return priv_bytes, pub_bytes

    if not os.path.exists(KEYS_DIR):
        os.makedirs(KEYS_DIR)
        
    if not os.path.exists(PRIVATE_KEY_PATH) or not os.path.exists(PUBLIC_KEY_PATH):
        print("Generating new RSA Keypair for RS256 JWT...")
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        public_key = private_key.public_key()

        # Lưu Private Key
        with open(PRIVATE_KEY_PATH, "wb") as f:
            f.write(private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            ))

        # Lưu Public Key
        with open(PUBLIC_KEY_PATH, "wb") as f:
            f.write(public_key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            ))

    with open(PRIVATE_KEY_PATH, "rb") as f:
        private_key_data = f.read()
        
    with open(PUBLIC_KEY_PATH, "rb") as f:
        public_key_data = f.read()
        
    return private_key_data, public_key_data

# Khởi tạo khóa ngay khi module được nạp
PRIVATE_KEY, PUBLIC_KEY = generate_or_load_keys()
