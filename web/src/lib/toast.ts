type ToastType = 'success' | 'error' | 'warning';

type ToastCallback = (type: ToastType, message: string) => void;

let globalToastCallback: ToastCallback | null = null;

export const setGlobalToastCallback = (callback: ToastCallback | null) => {
  globalToastCallback = callback;
};

export const toast = {
  success: (message: string) => globalToastCallback?.('success', message),
  error: (message: string) => globalToastCallback?.('error', message),
  warning: (message: string) => globalToastCallback?.('warning', message),
};
