import axiosInstance from './axios';
import type {
  LoginCredentials,
  SignUpRequest,
  OTPVerifyRequest,
  CompleteRegistrationRequest,
  AuthResponse,
  OTPResponse,
  OTPVerifyResponse,
  PasswordResetVerifyResponse,
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
