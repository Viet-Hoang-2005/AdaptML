import { useEffect, useMemo, useState } from 'react';
import {
  completePasswordChange,
  deleteAccount,
  getProfile,
  requestPasswordChangeOTP,
  updateProfile,
  verifyPasswordChangeOTP,
} from '../lib/api';
import { toast } from '../lib/toast';
import type { UserProfile } from '../types/auth';
import type { PasswordModalStep, ProfileFormValues } from '../types/settings';
import { useAuth } from './useAuth';

export const emptyProfileForm: ProfileFormValues = {
  fullName: '',
  description: '',
  pronouns: '',
  company: '',
  fieldOfWork: '',
  country: '',
};

const profileToForm = (profile: UserProfile): ProfileFormValues => ({
  fullName: profile.full_name || '',
  description: profile.description || '',
  pronouns: profile.pronouns || '',
  company: profile.company || '',
  fieldOfWork: profile.field_of_work || '',
  country: profile.country || '',
});

export function useProfileSettings() {
  const { logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [formValues, setFormValues] = useState<ProfileFormValues>(emptyProfileForm);
  const [initialFormValues, setInitialFormValues] = useState<ProfileFormValues>(emptyProfileForm);
  const [editingProfile, setEditingProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordModalStep, setPasswordModalStep] = useState<PasswordModalStep>('closed');
  const [otpCode, setOtpCode] = useState('');
  const [passwordChangeToken, setPasswordChangeToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordActionLoading, setPasswordActionLoading] = useState(false);
  const [passwordSendConfirmOpen, setPasswordSendConfirmOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    getProfile()
      .then((data) => {
        if (!mounted) return;
        const nextForm = profileToForm(data);
        setProfile(data);
        setFormValues(nextForm);
        setInitialFormValues(nextForm);
      })
      .catch(() => {
        if (mounted) {
          toast.error('Unable to load profile.');
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const profileChanged = useMemo(
    () => JSON.stringify(formValues) !== JSON.stringify(initialFormValues),
    [formValues, initialFormValues],
  );

  const updateProfileField = (field: keyof ProfileFormValues, value: string) => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        full_name: formValues.fullName,
        description: formValues.description,
        pronouns: formValues.pronouns,
        company: formValues.company,
        field_of_work: formValues.fieldOfWork,
        country: formValues.country,
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              full_name: formValues.fullName,
              description: formValues.description,
              pronouns: formValues.pronouns,
              company: formValues.company,
              field_of_work: formValues.fieldOfWork,
              country: formValues.country,
            }
          : current,
      );
      setInitialFormValues(formValues);
      setEditingProfile(false);
      toast.success('Profile updated successfully.');
    } catch {
      toast.error('Unable to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setFormValues(initialFormValues);
    setEditingProfile(false);
  };

  const openPasswordOTPModal = async () => {
    setPasswordSendConfirmOpen(false);
    setPasswordModalStep('otp');
    setOtpCode('');
    setPasswordChangeToken('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordActionLoading(true);
    try {
      await requestPasswordChangeOTP();
      toast.success('OTP has been sent to your email.');
    } catch {
      toast.error('Unable to send password change OTP.');
    } finally {
      setPasswordActionLoading(false);
    }
  };

  const handleVerifyPasswordOTP = async () => {
    if (otpCode.trim().length !== 6) {
      toast.warning('Please enter a valid 6-digit OTP.');
      return;
    }

    setPasswordActionLoading(true);
    try {
      const response = await verifyPasswordChangeOTP(otpCode.trim());
      setPasswordChangeToken(response.password_change_token);
      setPasswordModalStep('password');
      toast.success('OTP verified successfully.');
    } catch {
      toast.error('Invalid or expired OTP.');
    } finally {
      setPasswordActionLoading(false);
    }
  };

  const handleCompletePasswordChange = async () => {
    if (newPassword.length < 8) {
      toast.warning('Password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.warning('Passwords do not match.');
      return;
    }

    setPasswordActionLoading(true);
    try {
      await completePasswordChange(passwordChangeToken, newPassword);
      toast.success('Password changed successfully.');
      setPasswordModalStep('closed');
    } catch {
      toast.error('Unable to change password.');
    } finally {
      setPasswordActionLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      await deleteAccount();
      toast.success('Account deleted successfully.');
      logout();
    } catch {
      toast.error('Unable to delete account.');
    } finally {
      setDeleteLoading(false);
    }
  };

  return {
    profile,
    formValues,
    editingProfile,
    loading,
    saving,
    profileChanged,
    passwordModalStep,
    otpCode,
    newPassword,
    confirmPassword,
    passwordActionLoading,
    passwordSendConfirmOpen,
    deleteModalOpen,
    deleteLoading,
    setEditingProfile,
    setOtpCode,
    setNewPassword,
    setConfirmPassword,
    setPasswordModalStep,
    setPasswordSendConfirmOpen,
    setDeleteModalOpen,
    updateProfileField,
    handleSave,
    handleCancelEdit,
    openPasswordOTPModal,
    handleVerifyPasswordOTP,
    handleCompletePasswordChange,
    handleDeleteAccount,
  };
}
