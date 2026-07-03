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
  if (!axios.isAxiosError<unknown>(error)) {
    return error instanceof Error ? error.message : fallback;
  }

  const data = error.response?.data;
  if (!data) return error.message || fallback;
  if (typeof data === 'string') {
    return data.trim().startsWith('<') ? fallback : data;
  }
  if (typeof data !== 'object') {
    return error.message || fallback;
  }

  const body = data as ApiErrorBody;
  return body.error || body.detail || body.message || getFieldErrorMessage(body) || error.message || fallback;
};
