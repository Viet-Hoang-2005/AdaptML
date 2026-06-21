import { BriefcaseBusiness, Building2, CalendarDays, Camera, ChevronDown, FileText, Fingerprint, Globe2, LockKeyhole, Mail, ShieldCheck, Tags, Trash2, UserRound, Edit3 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AvatarCropModal } from '../../components/ui/AvatarCropModal';
import { AvatarModal } from '../../components/ui/AvatarModal';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Input, InputPassword } from '../../components/ui/Input';
import { OTPInput } from '../../components/ui/OTPInput';
import { useProfileSettings } from '../../hooks/useProfileSettings';
import { toast } from '../../lib/toast';
import type { UserProfile } from '../../types/auth';
import SettingsModal from './SettingsModal';

const formatDate = (value?: string) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const getInitials = (profile: UserProfile | null) => {
  const source = profile?.full_name || profile?.email || 'User';
  return source
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
};

const readOnlyFieldClass =
  'cursor-default hover:border-gray-300 focus:border-gray-300';

type AvatarModalState = 'closed' | 'options';

export default function ProfileSettingPage() {
  const {
    profile,
    avatarHistory,
    formValues,
    editingProfile,
    loading,
    saving,
    avatarSaving,
    avatarHistoryLoading,
    profileChanged,
    passwordModalStep,
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
    handleUpdateAvatar,
    handleRemoveAvatar,
    handleSelectAvatar,
    openPasswordOTPModal,
    handleVerifyPasswordOTP,
    handleCompletePasswordChange,
    handleDeleteAccount,
  } = useProfileSettings();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarModal, setAvatarModal] = useState<AvatarModalState>('closed');
  const [cropImage, setCropImage] = useState('');
  const [selectingAvatarId, setSelectingAvatarId] = useState<number | null>(null);
  const initials = useMemo(() => getInitials(profile), [profile]);
  const avatarPreview = profile?.avatar || '';

  useEffect(() => {
    return () => {
      if (cropImage) URL.revokeObjectURL(cropImage);
    };
  }, [cropImage]);

  const openAvatarModal = () => {
    setAvatarModal('options');
  };

  const openAvatarPicker = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarSelection = (file?: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.warning('Please select an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.warning('Avatar image must be 5MB or smaller.');
      return;
    }

    if (cropImage) URL.revokeObjectURL(cropImage);
    setAvatarModal('closed');
    setCropImage(URL.createObjectURL(file));
  };

  const closeCropModal = () => {
    if (cropImage) URL.revokeObjectURL(cropImage);
    setCropImage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const confirmAvatarCrop = async (file: File) => {
    await handleUpdateAvatar(file);
    closeCropModal();
  };

  const removeAvatar = async () => {
    await handleRemoveAvatar();
    setAvatarModal('closed');
  };

  const selectAvatar = async (avatarId: number) => {
    setSelectingAvatarId(avatarId);
    try {
      await handleSelectAvatar(avatarId);
      setAvatarModal('closed');
    } finally {
      setSelectingAvatarId(null);
    }
  };

  return (
    <div className="w-full space-y-6">
      <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex flex-col">
          <div className="flex-1 rounded-lg border border-gray-300 bg-white">
            <div className="flex flex-col items-center text-center p-6">
              <button
                type="button"
                onClick={openAvatarModal}
                disabled={loading || avatarSaving}
                className="group relative flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black text-4xl font-bold text-white outline-none ring-offset-2 transition focus:ring-2 focus:ring-black disabled:cursor-not-allowed disabled:opacity-70"
                aria-label="Update avatar"
                title="Update avatar"
              >
                {avatarPreview ? <img src={avatarPreview} alt="" className="h-full w-full object-cover" /> : initials}
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
                  <Camera className="h-7 w-7 text-white" />
                </span>
              </button>
              <h2 className="mt-5 max-w-full truncate text-xl font-bold text-gray-900">
                {profile?.full_name || 'AI Engineer'}
              </h2>
              <p className="mt-1 max-w-full truncate text-sm text-gray-500">{profile?.email || 'Loading profile...'}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleAvatarSelection(event.target.files?.[0])}
            />

            <div className="mx-auto h-px w-64 rounded-full bg-gray-300" />

            <div className="p-6">
              <div className="space-y-3">
                <ReadOnlyRow icon={<Mail className="h-4 w-4" />} label="Email" value={profile?.email || 'Unknown'} />
                <ReadOnlyRow icon={<Fingerprint className="h-4 w-4" />} label="Tenant ID" value={profile?.tenant_id || 'Unknown'} />
                <ReadOnlyRow icon={<ShieldCheck className="h-4 w-4" />} label="Provider" value={profile?.auth_provider || 'Unknown'} />
                <ReadOnlyRow icon={<CalendarDays className="h-4 w-4" />} label="Joined" value={formatDate(profile?.date_joined)} />
              </div>
            </div>
          </div>

        </aside>

        <div className="rounded-lg border border-gray-300 bg-white p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-gray-900">Profile Information</h3>
              {editingProfile ? (
                <div className="flex gap-2">
                  <Button variant="secondary" size="md" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                  <Button
                    id="btn-save-profile"
                    size="md"
                    loading={saving}
                    disabled={loading || !profileChanged}
                    onClick={handleSave}
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <Button
                  id="btn-edit-profile"
                  variant="secondary"
                  size="md"
                  onClick={() => setEditingProfile(true)}
                  disabled={loading}
                >
                  <Edit3 className="h-4 w-4" />
                  Edit Profile
                </Button>
              )}
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                id="profile-full-name"
                label="Full Name"
                icon={<UserRound className="h-4 w-4 text-gray-400" />}
                placeholder="Enter your full name"
                value={formValues.fullName}
                disabled={loading}
                readOnly={!editingProfile}
                tabIndex={!editingProfile ? -1 : undefined}
                className={!editingProfile ? readOnlyFieldClass : ''}
                onChange={(event) => updateProfileField('fullName', event.target.value)}
              />
              {editingProfile ? (
                <label htmlFor="profile-pronouns" className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                  Pronouns
                  <div className="relative">
                    <Tags className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <select
                      id="profile-pronouns"
                      value={formValues.pronouns}
                      disabled={loading}
                      onChange={(event) => updateProfileField('pronouns', event.target.value)}
                      className="h-14 w-full appearance-none rounded-2xl border border-gray-300 bg-white pl-10 pr-10 text-sm font-normal text-gray-800 outline-none transition-colors duration-200 hover:border-black focus:border-black disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="">Don't specify</option>
                      <option value="he/him">he/him</option>
                      <option value="she/her">she/her</option>
                      <option value="they/them">they/them</option>
                      <option value="other">other</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  </div>
                </label>
              ) : (
                <Input
                  id="profile-pronouns"
                  label="Pronouns"
                  icon={<Tags className="h-4 w-4 text-gray-400" />}
                  value={formValues.pronouns || "Don't specify"}
                  disabled={loading}
                  readOnly
                  tabIndex={-1}
                  className={readOnlyFieldClass}
                />
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                id="profile-company"
                label="Company"
                icon={<Building2 className="h-4 w-4 text-gray-400" />}
                placeholder="e.g. UIT"
                value={formValues.company}
                disabled={loading}
                readOnly={!editingProfile}
                tabIndex={!editingProfile ? -1 : undefined}
                className={!editingProfile ? readOnlyFieldClass : ''}
                onChange={(event) => updateProfileField('company', event.target.value)}
              />
              <Input
                id="profile-field-of-work"
                label="Field of Work"
                icon={<BriefcaseBusiness className="h-4 w-4 text-gray-400" />}
                placeholder="e.g. Machine Learning"
                value={formValues.fieldOfWork}
                disabled={loading}
                readOnly={!editingProfile}
                tabIndex={!editingProfile ? -1 : undefined}
                className={!editingProfile ? readOnlyFieldClass : ''}
                onChange={(event) => updateProfileField('fieldOfWork', event.target.value)}
              />
            </div>
            
            <Input
              id="profile-country"
              label="Country"
              icon={<Globe2 className="h-4 w-4 text-gray-400" />}
              placeholder="e.g. Vietnam"
              value={formValues.country}
              disabled={loading}
              readOnly={!editingProfile}
              tabIndex={!editingProfile ? -1 : undefined}
              className={!editingProfile ? readOnlyFieldClass : ''}
              onChange={(event) => updateProfileField('country', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleSave()}
            />
            
            <label htmlFor="profile-description" className="flex flex-col gap-2 text-sm font-medium text-gray-700">
              Description
              <div className="relative">
                <FileText className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-gray-400" />
                <textarea
                  id="profile-description"
                  className={`text-sm text-gray-800 placeholder-gray-400 font-normal placeholder:font-normal min-h-24 w-full resize-y rounded-2xl border border-gray-300 bg-white py-3 pl-10 pr-4 outline-none transition-colors duration-200 disabled:bg-gray-50 disabled:text-gray-400 ${
                    editingProfile ? 'hover:border-black focus:border-black' : 'cursor-default hover:border-gray-300 focus:border-gray-300'
                  }`}
                  placeholder="Tell us more about yourself"
                  value={formValues.description}
                  disabled={loading}
                  readOnly={!editingProfile}
                  tabIndex={!editingProfile ? -1 : undefined}
                  onChange={(event) => updateProfileField('description', event.target.value)}
                />
              </div>
            </label>

            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <Button
                id="btn-change-password"
                variant="primary"
                icon={<LockKeyhole className="h-4 w-4" />}
                onClick={() => setPasswordSendConfirmOpen(true)}
                disabled={loading}
              >
                Change Password
              </Button>
              <Button
                id="btn-delete-account"
                variant="danger"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => setDeleteModalOpen(true)}
                disabled={loading}
              >
                Delete Account
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ConfirmModal
        open={passwordSendConfirmOpen}
        title="Send password change OTP?"
        description={
          <>
            We will send a 6-digit OTP to{' '}
            <span className="font-semibold text-gray-700">{profile?.email}</span> to verify this password change.
          </>
        }
        confirmText="Send OTP"
        loading={passwordActionLoading}
        onCancel={() => setPasswordSendConfirmOpen(false)}
        onConfirm={openPasswordOTPModal}
      />

      {passwordModalStep === 'otp' && (
        <SettingsModal title="Verify OTP" onClose={() => setPasswordModalStep('closed')}>
          <p className="mb-4 text-sm text-gray-500">
            Enter the 6-digit OTP sent to <span className="font-semibold text-gray-700">{profile?.email}</span>.
          </p>
          <OTPInput
            onComplete={(otp) => {
              setOtpCode(otp);
            }}
            disabled={passwordActionLoading}
          />
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setPasswordModalStep('closed')}>Cancel</Button>
            <Button loading={passwordActionLoading} onClick={handleVerifyPasswordOTP}>Verify OTP</Button>
          </div>
        </SettingsModal>
      )}

      {passwordModalStep === 'password' && (
        <SettingsModal title="Set New Password" onClose={() => setPasswordModalStep('closed')}>
          <div className="space-y-4">
            <InputPassword
              id="input-change-new-password"
              label="New Password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <InputPassword
              id="input-change-confirm-password"
              label="Confirm Password"
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleCompletePasswordChange()}
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setPasswordModalStep('closed')}>Cancel</Button>
            <Button loading={passwordActionLoading} onClick={handleCompletePasswordChange}>Change Password</Button>
          </div>
        </SettingsModal>
      )}

      <ConfirmModal
        open={deleteModalOpen}
        title="Delete Account?"
        tone="danger"
        description={
          <>
            This will temporarily disable your account and pause related API model access. You will be signed out after deletion.
            <br />
            <br />
            Are you sure you want to delete the account{' '}
            <span className="font-semibold text-gray-700">{profile?.email}</span>?
          </>
        }
        confirmText="Delete Account"
        loading={deleteLoading}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteAccount}
      />

      <AvatarModal
        open={avatarModal === 'options'}
        avatarPreview={avatarPreview}
        avatarHistory={avatarHistory}
        historyLoading={avatarHistoryLoading}
        selectingAvatarId={selectingAvatarId}
        onClose={() => setAvatarModal('closed')}
        onRemove={removeAvatar}
        onChange={openAvatarPicker}
        onSelectAvatar={selectAvatar}
      />

      <AvatarCropModal
        imageSrc={cropImage}
        loading={avatarSaving}
        onClose={closeCropModal}
        onConfirm={confirmAvatarCrop}
        onError={() => toast.error('Unable to crop avatar. Please try another image.')}
      />
    </div>
  );
}

function ReadOnlyRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md bg-gray-50 px-3 py-3">
      <span className="mt-0.5 text-gray-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <p className="truncate text-sm font-semibold text-gray-800">{value}</p>
      </div>
    </div>
  );
}
