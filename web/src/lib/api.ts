import axiosInstance from './axios';
import type {
  LoginCredentials,
  SignUpRequest,
  OTPVerifyRequest,
  CompleteRegistrationRequest,
  AuthResponse,
  OTPResponse,
  OTPVerifyResponse,
  MessageResponse,
  APIKeyRecord,
  APIKeyListResponse,
  CreateAPIKeyRequest,
  CreatedAPIKeyResponse,
  PasswordChangeVerifyResponse,
  PasswordResetVerifyResponse,
  UpdateProfileRequest,
  UserProfile,
} from '../types/auth';

// 1. AUTHENTICATION
// Base Auth
export const loginBaseAuth = async (credentials: LoginCredentials): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/token/', credentials);
  return data;
};

export const requestOTP = async (payload: SignUpRequest): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/register/request-otp/', payload);
  return data;
};

export const verifyOTP = async (payload: OTPVerifyRequest): Promise<OTPVerifyResponse> => {
  const { data } = await axiosInstance.post<OTPVerifyResponse>('/register/verify-otp/', payload);
  return data;
};

export const completeRegistration = async (payload: CompleteRegistrationRequest): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/register/complete/', payload);
  return data;
};

// OAuth
export const loginGoogle = async (token: string): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/oauth/google/', { token });
  return data;
};

export const loginGitHub = async (code: string, redirectUri: string): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/oauth/github/', {
    code,
    redirect_uri: redirectUri,
  });
  return data;
};

// Forgot Password
export const forgotPasswordOTP = async (email: string): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/password-reset/request-otp/', { email });
  return data;
};

export const verifyForgotPasswordOTP = async (
  email: string,
  otpCode: string,
): Promise<PasswordResetVerifyResponse> => {
  const { data } = await axiosInstance.post<PasswordResetVerifyResponse>('/password-reset/verify-otp/', {
    email,
    otp_code: otpCode,
  });
  return data;
};

export const resetForgottenPassword = async (resetToken: string, newPassword: string): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/password-reset/complete/', {
    reset_token: resetToken,
    new_password: newPassword,
  });
  return data;
};

// Profile
export const getProfile = async (): Promise<UserProfile> => {
  const { data } = await axiosInstance.get<UserProfile>('/profile/me/');
  return data;
};

export const updateProfile = async (payload: UpdateProfileRequest): Promise<MessageResponse> => {
  const { data } = await axiosInstance.put<MessageResponse>('/profile/me/', payload);
  return data;
};

export const deleteAccount = async (): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>('/profile/delete/');
  return data;
};

export const requestPasswordChangeOTP = async (): Promise<MessageResponse> => {
  const { data } = await axiosInstance.post<MessageResponse>('/profile/password-otp/');
  return data;
};

export const verifyPasswordChangeOTP = async (otpCode: string): Promise<PasswordChangeVerifyResponse> => {
  const { data } = await axiosInstance.post<PasswordChangeVerifyResponse>('/profile/password-otp/verify/', {
    otp_code: otpCode,
  });
  return data;
};

export const completePasswordChange = async (
  passwordChangeToken: string,
  newPassword: string,
): Promise<MessageResponse> => {
  const { data } = await axiosInstance.post<MessageResponse>('/profile/change-password/', {
    password_change_token: passwordChangeToken,
    new_password: newPassword,
  });
  return data;
};

export const createAPIKey = async (payload: CreateAPIKeyRequest): Promise<CreatedAPIKeyResponse> => {
  const { data } = await axiosInstance.post<CreatedAPIKeyResponse>('/profile/api-key/', payload);
  return data;
};

export const listAPIKeys = async (): Promise<APIKeyListResponse> => {
  const { data } = await axiosInstance.get<APIKeyListResponse>('/profile/api-key/');
  return data;
};

export const updateAPIKey = async (keyId: number, payload: CreateAPIKeyRequest): Promise<APIKeyRecord & MessageResponse> => {
  const { data } = await axiosInstance.put<APIKeyRecord & MessageResponse>(`/profile/api-key/${keyId}/`, payload);
  return data;
};

export const deleteAPIKey = async (keyId: number): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(`/profile/api-key/${keyId}/`);
  return data;
};

export const regenerateAPIKey = async (keyId: number): Promise<CreatedAPIKeyResponse> => {
  const { data } = await axiosInstance.post<CreatedAPIKeyResponse>(`/profile/api-key/${keyId}/regenerate/`);
  return data;
};
