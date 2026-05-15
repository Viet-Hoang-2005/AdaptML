import axiosInstance from './axios';
import type {
  LoginCredentials,
  SignUpRequest,
  OTPVerifyRequest,
  CompleteRegistrationRequest,
  AuthResponse,
  OTPResponse,
  OTPVerifyResponse,
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

export const loginGitHub = async (token: string): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/oauth/github/', { token });
  return data;
};

// Forgot Password
export const forgotPasswordOTP = async (email: string): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/profile/password-otp/', { email });
  return data;
};
