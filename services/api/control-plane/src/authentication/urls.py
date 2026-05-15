from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import CustomTokenObtainPairView, JWKSView
from .base_auth_views import RequestOTPView, VerifyOTPView, CompleteRegistrationView
from .oauth2_views import GoogleOAuthView, GitHubOAuthView
from .profile_views import ProfileView, PasswordChangeRequestView, PasswordChangeCompleteView, AccountDeleteView, APIKeyManagementView

urlpatterns = [
    # JWT & JWKS
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('.well-known/jwks.json', JWKSView.as_view(), name='jwks'),
    
    # Base Auth (Đăng ký bằng OTP)
    path('register/request-otp/', RequestOTPView.as_view(), name='request_otp'),
    path('register/verify-otp/', VerifyOTPView.as_view(), name='verify_otp'),
    path('register/complete/', CompleteRegistrationView.as_view(), name='complete_registration'),
    
    # OAuth2
    path('oauth/google/', GoogleOAuthView.as_view(), name='oauth_google'),
    path('oauth/github/', GitHubOAuthView.as_view(), name='oauth_github'),
    
    # Profile & Quản lý tài khoản
    path('profile/me/', ProfileView.as_view(), name='profile_me'),
    path('profile/password-otp/', PasswordChangeRequestView.as_view(), name='password_change_otp'),
    path('profile/change-password/', PasswordChangeCompleteView.as_view(), name='password_change_complete'),
    path('profile/api-key/', APIKeyManagementView.as_view(), name='api_key_manage'),
    path('profile/delete/', AccountDeleteView.as_view(), name='account_delete'),
]
