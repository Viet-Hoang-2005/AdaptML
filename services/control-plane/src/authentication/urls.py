from django.urls import path
from .views import CustomTokenObtainPairView, CustomTokenRefreshView, JWKSView
from .base_auth_views import RequestOTPView, VerifyOTPView, CompleteRegistrationView
from .oauth2_views import GoogleOAuthView, GitHubOAuthView
from .password_reset_views import PasswordResetCompleteView, PasswordResetRequestOTPView, PasswordResetVerifyOTPView
from .profile_views import ProfileView, PasswordChangeRequestView, PasswordChangeVerifyOTPView, PasswordChangeCompleteView, AccountDeleteView, APIKeyManagementView, APIKeyDetailView, APIKeyRegenerateView, AvatarHistoryView, AvatarSelectView

urlpatterns = [
    # JWT & JWKS
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', CustomTokenRefreshView.as_view(), name='token_refresh'),
    path('.well-known/jwks.json', JWKSView.as_view(), name='jwks'),
    
    # Base Auth (Đăng ký bằng OTP)
    path('register/request-otp/', RequestOTPView.as_view(), name='request_otp'),
    path('register/verify-otp/', VerifyOTPView.as_view(), name='verify_otp'),
    path('register/complete/', CompleteRegistrationView.as_view(), name='complete_registration'),
    
    # OAuth2
    path('oauth/google/', GoogleOAuthView.as_view(), name='oauth_google'),
    path('oauth/github/', GitHubOAuthView.as_view(), name='oauth_github'),

    # Forgot Password
    path('password-reset/request-otp/', PasswordResetRequestOTPView.as_view(), name='password_reset_request_otp'),
    path('password-reset/verify-otp/', PasswordResetVerifyOTPView.as_view(), name='password_reset_verify_otp'),
    path('password-reset/complete/', PasswordResetCompleteView.as_view(), name='password_reset_complete'),
    
    # Profile & Quản lý tài khoản
    path('profile/me/', ProfileView.as_view(), name='profile_me'),
    path('profile/password-otp/', PasswordChangeRequestView.as_view(), name='password_change_otp'),
    path('profile/password-otp/verify/', PasswordChangeVerifyOTPView.as_view(), name='password_change_verify_otp'),
    path('profile/change-password/', PasswordChangeCompleteView.as_view(), name='password_change_complete'),
    path('profile/api-key/', APIKeyManagementView.as_view(), name='api_key_manage'),
    path('profile/api-key/<int:key_id>/', APIKeyDetailView.as_view(), name='api_key_detail'),
    path('profile/api-key/<int:key_id>/regenerate/', APIKeyRegenerateView.as_view(), name='api_key_regenerate'),
    path('profile/avatars/', AvatarHistoryView.as_view(), name='profile_avatars'),
    path('profile/avatars/<int:avatar_id>/select/', AvatarSelectView.as_view(), name='profile_avatar_select'),
    path('profile/delete/', AccountDeleteView.as_view(), name='account_delete'),
]
