import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  completePasswordChange,
  deleteAccount,
  getProfile,
  listProfileAvatars,
  requestPasswordChangeOTP,
  selectProfileAvatar,
  updateProfile,
  updateProfileAvatar,
  verifyPasswordChangeOTP,
} from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { queryKeys } from '../lib/queryKeys';
import { toast } from '../lib/toast';
import type { UpdateProfileRequest, UserProfile } from '../types/auth';
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
  const queryClient = useQueryClient();
  const [draftFormValues, setDraftFormValues] = useState<ProfileFormValues>(emptyProfileForm);
  const [editingProfile, setEditingProfile] = useState(false);
  const [passwordModalStep, setPasswordModalStep] = useState<PasswordModalStep>('closed');
  const [otpCode, setOtpCode] = useState('');
  const [passwordChangeToken, setPasswordChangeToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordActionLoading, setPasswordActionLoading] = useState(false);
  const [passwordSendConfirmOpen, setPasswordSendConfirmOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const profileQuery = useQuery({
    queryKey: queryKeys.profile,
    queryFn: getProfile,
  });
  const avatarHistoryQuery = useQuery({
    queryKey: queryKeys.profileAvatars,
    queryFn: listProfileAvatars,
  });

  const profile = profileQuery.data ?? null;
  const profileFormValues = useMemo(
    () => (profile ? profileToForm(profile) : emptyProfileForm),
    [profile],
  );
  const formValues = editingProfile ? draftFormValues : profileFormValues;

  useEffect(() => {
    if (profileQuery.isError) {
      toast.error(getApiErrorMessage(profileQuery.error, 'Unable to load profile.'));
    }
  }, [profileQuery.error, profileQuery.isError]);

  const updateProfileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (_response, variables: UpdateProfileRequest) => {
      const updatedProfile = profile
        ? {
            ...profile,
            full_name: variables.full_name,
            description: variables.description,
            pronouns: variables.pronouns,
            company: variables.company,
            field_of_work: variables.field_of_work,
            country: variables.country,
          }
        : null;

      if (updatedProfile) {
        queryClient.setQueryData<UserProfile>(queryKeys.profile, updatedProfile);
      }
      setEditingProfile(false);
      toast.success('Profile updated successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to update profile.'));
    },
  });

  const updateAvatarMutation = useMutation({
    mutationFn: updateProfileAvatar,
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profileAvatars }),
      ]);
      toast.success(variables.remove_avatar ? 'Avatar removed successfully.' : 'Avatar updated successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to update avatar.'));
    },
  });

  const selectAvatarMutation = useMutation({
    mutationFn: selectProfileAvatar,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profileAvatars }),
      ]);
      toast.success('Avatar selected successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to select avatar.'));
    },
  });

  const profileChanged = useMemo(
    () => editingProfile && JSON.stringify(draftFormValues) !== JSON.stringify(profileFormValues),
    [draftFormValues, editingProfile, profileFormValues],
  );

  const updateProfileField = (field: keyof ProfileFormValues, value: string) => {
    setDraftFormValues((current) => ({ ...current, [field]: value }));
  };

  const setProfileEditing = (editing: boolean) => {
    if (editing) {
      setDraftFormValues(profileFormValues);
    }
    setEditingProfile(editing);
  };

  const handleSave = async () => {
    updateProfileMutation.mutate({
      full_name: formValues.fullName,
      description: formValues.description,
      pronouns: formValues.pronouns,
      company: formValues.company,
      field_of_work: formValues.fieldOfWork,
      country: formValues.country,
    });
  };

  const handleCancelEdit = () => {
    setDraftFormValues(profileFormValues);
    setEditingProfile(false);
  };

  const handleUpdateAvatar = async (avatar: File) => {
    await updateAvatarMutation.mutateAsync({ avatar });
  };

  const handleRemoveAvatar = async () => {
    await updateAvatarMutation.mutateAsync({ remove_avatar: true });
  };

  const handleSelectAvatar = async (avatarId: number) => {
    await selectAvatarMutation.mutateAsync(avatarId);
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
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to send password change OTP.'));
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
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Invalid or expired OTP.'));
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
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to change password.'));
    } finally {
      setPasswordActionLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      await deleteAccount();
      toast.success('Account deleted successfully.');
      queryClient.clear();
      logout();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to delete account.'));
    } finally {
      setDeleteLoading(false);
    }
  };

  return {
    profile,
    avatarHistory: avatarHistoryQuery.data?.avatars ?? [],
    formValues,
    editingProfile,
    loading: profileQuery.isLoading,
    saving: updateProfileMutation.isPending,
    avatarSaving: updateAvatarMutation.isPending,
    avatarHistoryLoading: avatarHistoryQuery.isLoading,
    selectingAvatar: selectAvatarMutation.isPending,
    profileChanged,
    passwordModalStep,
    otpCode,
    newPassword,
    confirmPassword,
    passwordActionLoading,
    passwordSendConfirmOpen,
    deleteModalOpen,
    deleteLoading,
    setEditingProfile: setProfileEditing,
    setOtpCode,
    setNewPassword,
    setConfirmPassword,
    setPasswordModalStep,
    setPasswordSendConfirmOpen,
    setDeleteModalOpen,
    updateProfileField,
    handleSave,
    handleCancelEdit,
    handleUpdateAvatar,
    handleRemoveAvatar,
    handleSelectAvatar,
    openPasswordOTPModal,
    handleVerifyPasswordOTP,
    handleCompletePasswordChange,
    handleDeleteAccount,
  };
}
