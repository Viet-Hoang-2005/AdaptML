import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../lib/toast';
import { loginBaseAuth } from '../lib/api';
import type { LoginCredentials } from '../types/auth';

// Token helpers
export const getAccessToken = () => localStorage.getItem('access_token');
export const getRefreshToken = () => localStorage.getItem('refresh_token');
export const isAuthenticated = () => !!getAccessToken();

const saveTokens = (access: string, refresh: string) => {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
};

const clearTokens = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};

/**
 * useAuth – Quản lý toàn bộ luồng xác thực:
 * login, logout, lưu/xóa token.
 * Sẽ được mở rộng thêm OAuth, refresh token, user profile sau.
 */
export function useAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  /** Đăng nhập bằng email + password */
  const login = useCallback(
    async (credentials: LoginCredentials) => {
      if (!credentials.email || !credentials.password) {
        toast.warning('Please enter your email and password.');
        return;
      }
      setLoading(true);
      try {
        const response = await loginBaseAuth(credentials);
        saveTokens(response.access, response.refresh);
        toast.success('Login successful!');
        navigate('/dashboard');
      } catch {
        toast.error('Invalid email or password.');
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  /** Lưu token sau khi đăng ký / OAuth thành công từ bên ngoài */
  const saveAuthTokens = useCallback(
    (access: string, refresh: string, redirectTo = '/dashboard') => {
      saveTokens(access, refresh);
      navigate(redirectTo);
    },
    [navigate],
  );

  /** Đăng xuất */
  const logout = useCallback(() => {
    clearTokens();
    toast.success('Logged out successfully.');
    navigate('/login');
  }, [navigate]);

  return { login, logout, saveAuthTokens, loading, isAuthenticated };
}
