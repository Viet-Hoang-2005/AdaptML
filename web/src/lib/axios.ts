import axios, { type InternalAxiosRequestConfig } from 'axios';

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

type TokenRefreshResponse = {
  access: string;
  refresh?: string;
};

const apiBaseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/auth';
const refreshTokenPath = '/token/refresh/';
const publicAuthPaths = ['/token/', '/oauth/', '/register/', '/password-reset/'];

let refreshPromise: Promise<string> | null = null;

const buildURL = (baseURL: string, path: string) => `${baseURL.replace(/\/+$/, '')}${path}`;

const isPublicAuthRequest = (url = '') =>
  publicAuthPaths.some((path) => url.includes(path));

const clearAuthAndRedirect = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('tenant_id');

  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

export const refreshAccessToken = () => {
  const refreshToken = localStorage.getItem('refresh_token');

  if (!refreshToken) {
    return Promise.reject(new Error('Missing refresh token.'));
  }

  if (!refreshPromise) {
    refreshPromise = axios
      .post<TokenRefreshResponse>(
        buildURL(apiBaseURL, refreshTokenPath),
        { refresh: refreshToken },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
      .then((response) => {
        localStorage.setItem('access_token', response.data.access);
        if (response.data.refresh) {
          localStorage.setItem('refresh_token', response.data.refresh);
        }
        return response.data.access;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

const axiosInstance = axios.create({
  baseURL: apiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the current access token to authenticated requests.
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: unknown) => Promise.reject(error),
);

// Refresh an expired access token once, then retry the original request.
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (!originalRequest || originalRequest._retry || isPublicAuthRequest(originalRequest.url)) {
      if (originalRequest?._retry) {
        clearAuthAndRedirect();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return axiosInstance(originalRequest);
    } catch (refreshError) {
      clearAuthAndRedirect();
      return Promise.reject(refreshError);
    }
  },
);

export default axiosInstance;
