import os
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

KEYS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'keys')
PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, 'private_key.pem')
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, 'public_key.pem')

def generate_or_load_keys():
    """Tự động sinh ra cặp khóa RSA (2048-bit) nếu chưa tồn tại, hoặc load từ file."""
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
