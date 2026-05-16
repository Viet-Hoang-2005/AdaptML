import type { APIKeyRecord } from './auth';

export interface ProfileFormValues {
  fullName: string;
  description: string;
  pronouns: string;
  company: string;
  fieldOfWork: string;
  country: string;
}

export type PasswordModalStep = 'closed' | 'otp' | 'password';

export type KeyModalMode = 'create' | 'edit';

export interface APIKeyFormValues {
  name: string;
  description: string;
}

export type APIKeyActionTarget = APIKeyRecord | null;
