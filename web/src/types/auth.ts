// 1. Auth
// Request Types
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignUpRequest {
  email: string;
}

export interface OTPVerifyRequest {
  email: string;
  otp_code: string;
}

export interface CompleteRegistrationRequest {
  registration_token: string;
  full_name: string;
  avatar?: File | null;
  field_of_work: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface PasswordResetVerifyRequest {
  email: string;
  otp_code: string;
}

export interface PasswordResetCompleteRequest {
  reset_token: string;
  new_password: string;
}

export interface UserProfile {
  email: string;
  full_name: string | null;
  description: string | null;
  pronouns: string | null;
  company: string | null;
  avatar: string | null;
  field_of_work: string | null;
  country: string | null;
  tenant_id: string;
  auth_provider: string;
  date_joined: string;
}

export interface UpdateProfileRequest {
  full_name: string;
  description: string;
  pronouns: string;
  company: string;
  field_of_work: string;
  country: string;
}

export interface UpdateProfileAvatarRequest {
  avatar?: File | null;
  remove_avatar?: boolean;
}

export interface PasswordChangeVerifyResponse {
  message: string;
  password_change_token: string;
}

export interface CreateAPIKeyRequest {
  name: string;
  description: string;
}

export interface CreatedAPIKeyResponse {
  message: string;
  api_key: string;
  key_prefix: string;
  id: number;
  name: string;
  description: string;
  created_at?: string;
}

export interface APIKeyRecord {
  id: number;
  name: string;
  description: string;
  key_prefix: string;
  created_at: string;
}

export interface APIKeyListResponse {
  tenant_id: string;
  api_keys: APIKeyRecord[];
}

// Response Types
export interface AuthResponse {
  message: string;
  access: string;
  refresh: string;
  tenant_id: string;
  is_new_user?: boolean;
}

export interface OTPResponse {
  message: string;
  email: string;
}

export interface OTPVerifyResponse {
  message: string;
  registration_token: string;
}

export interface PasswordResetVerifyResponse {
  message: string;
  reset_token: string;
}

export interface MessageResponse {
  message: string;
}

export interface ApiErrorResponse {
  error: string;
}
