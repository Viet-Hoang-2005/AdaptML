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
  token: string;
  full_name: string;
  avatar?: File | null;
  field_of_work: string;
  country: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

// Response Types
export interface AuthResponse {
  message: string;
  access: string;
  refresh: string;
  tenant_id: string;
  is_new_user: boolean;
}

export interface OTPResponse {
  message: string;
  email: string;
}

export interface OTPVerifyResponse {
  message: string;
  token: string;
}

export interface ApiErrorResponse {
  error: string;
}
