import secrets
import string

from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail

OTP_LENGTH = 6
OTP_TTL_SECONDS = 300
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5

def normalize_email(email):
    return (email or "").strip().lower()

def generate_otp(length=OTP_LENGTH):
    return "".join(secrets.choice(string.digits) for _ in range(length))

def send_otp_email(email, otp_code):
    subject = "AI PaaS - Verification Code"
    message = (
        f"Your verification code is: {otp_code}. "
        "This code is valid for 5 minutes.\n"
        "Please do not share this code with anyone."
    )

    send_mail(
        subject,
        message,
        settings.EMAIL_HOST_USER,
        [email],
        fail_silently=False,
    )

def request_otp(email):
    email = normalize_email(email)
    cooldown_key = f"otp_cooldown:{email}"

    if cache.get(cooldown_key):
        return False, "Please wait before requesting another OTP."

    otp_code = generate_otp()
    cache.set(f"otp:{email}", otp_code, timeout=OTP_TTL_SECONDS)
    cache.delete(f"otp_attempts:{email}")
    cache.set(cooldown_key, True, timeout=OTP_RESEND_COOLDOWN_SECONDS)

    send_otp_email(email, otp_code)
    return True, "OTP sent successfully."

def verify_otp(email, otp_code):
    email = normalize_email(email)
    attempts_key = f"otp_attempts:{email}"
    attempts = int(cache.get(attempts_key) or 0)

    if attempts >= OTP_MAX_ATTEMPTS:
        return False

    cached_otp = cache.get(f"otp:{email}")

    if cached_otp and str(cached_otp) == str(otp_code):
        cache.delete(f"otp:{email}")
        cache.delete(attempts_key)
        cache.delete(f"otp_cooldown:{email}")
        return True

    cache.set(attempts_key, attempts + 1, timeout=OTP_TTL_SECONDS)
    return False
