import random
import string
from django.core.cache import cache
from django.core.mail import send_mail
from django.conf import settings

def generate_otp(length=6):
    """Sinh chuỗi số ngẫu nhiên làm mã OTP."""
    return ''.join(random.choices(string.digits, k=length))

def send_otp_email(email, otp_code):
    """Gửi email chứa mã OTP đến người dùng."""
    subject = "AI PaaS - Mã Xác Nhận (OTP)"
    message = f"Mã xác nhận của bạn là: {otp_code}. Mã này có hiệu lực trong 5 phút.\nVui lòng không chia sẻ mã này cho bất kỳ ai."
    from_email = settings.EMAIL_HOST_USER
    
    send_mail(
        subject,
        message,
        from_email,
        [email],
        fail_silently=False,
    )

def request_otp(email):
    """Sinh mã OTP, lưu vào Redis và gửi qua Email."""
    otp_code = generate_otp()
    
    # Lưu vào Redis với TTL là 300 giây (5 phút)
    cache_key = f"otp:{email}"
    cache.set(cache_key, otp_code, timeout=300)
    
    # Gửi email
    send_otp_email(email, otp_code)
    
    return True

def verify_otp(email, otp_code):
    """Kiểm tra mã OTP từ Redis."""
    cache_key = f"otp:{email}"
    cached_otp = cache.get(cache_key)
    
    if cached_otp and str(cached_otp) == str(otp_code):
        # Xác thực thành công -> Xóa mã OTP khỏi Redis để tránh tái sử dụng
        cache.delete(cache_key)
        return True
        
    return False
