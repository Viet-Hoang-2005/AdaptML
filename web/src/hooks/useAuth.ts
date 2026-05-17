import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginBaseAuth, loginGitHub, loginGoogle } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { toast } from '../lib/toast';
import type { AuthResponse, LoginCredentials } from '../types/auth';

export const getAccessToken = () => localStorage.getItem('access_token');
export const getRefreshToken = () => localStorage.getItem('refresh_token');
export const isAuthenticated = () => !!getAccessToken();

const saveTokens = (access: string, refresh: string, tenantId?: string) => {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
  if (tenantId) {
    localStorage.setItem('tenant_id', tenantId);
  }
};

const clearTokens = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('tenant_id');
};

export function useAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleOAuthSuccess = useCallback(
    (response: AuthResponse, successMessage = 'OAuth login successful!') => {
      saveTokens(response.access, response.refresh, response.tenant_id);
      toast.success(successMessage);
      navigate('/dashboard');
    },
    [navigate],
  );

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      if (!credentials.email || !credentials.password) {
        toast.warning('Please enter your email and password.');
        return;
      }

      setLoading(true);
      try {
        const response = await loginBaseAuth(credentials);
        saveTokens(response.access, response.refresh, response.tenant_id);
        toast.success('Login successful!');
        navigate('/dashboard');
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Invalid email or password.'));
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  const loginWithGoogle = useCallback(
    async (googleToken: string) => {
      setLoading(true);
      try {
        const response = await loginGoogle(googleToken);
        handleOAuthSuccess(response, 'Google login successful!');
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Google login failed. Please try again.'));
      } finally {
        setLoading(false);
      }
    },
    [handleOAuthSuccess],
  );

  const loginWithGitHubCode = useCallback(
    async (code: string, redirectUri: string) => {
      setLoading(true);
      try {
        const response = await loginGitHub(code, redirectUri);
        handleOAuthSuccess(response, 'GitHub login successful!');
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'GitHub login failed. Please try again.'));
        navigate('/login');
      } finally {
        setLoading(false);
      }
    },
    [handleOAuthSuccess, navigate],
  );

  const saveAuthTokens = useCallback(
    (access: string, refresh: string, redirectTo = '/dashboard', tenantId?: string) => {
      saveTokens(access, refresh, tenantId);
      navigate(redirectTo);
    },
    [navigate],
  );

  const logout = useCallback(() => {
    clearTokens();
    toast.success('Logged out successfully.');
    navigate('/login');
  }, [navigate]);

  return {
    login,
    logout,
    saveAuthTokens,
    loginWithGoogle,
    loginWithGitHubCode,
    loading,
    isAuthenticated,
  };
}
