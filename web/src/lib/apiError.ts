import axios from 'axios';

type ApiErrorBody = {
  error?: string;
  detail?: string;
  message?: string;
  [key: string]: unknown;
};

const getFieldErrorMessage = (data: ApiErrorBody) => {
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }

    if (typeof value === 'string') {
      return value;
    }
  }

  return null;
};

export const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (!axios.isAxiosError<ApiErrorBody>(error)) {
    return fallback;
  }

  const data = error.response?.data;
  if (!data) return fallback;

  return data.error || data.detail || data.message || getFieldErrorMessage(data) || fallback;
};
