import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Briefcase, Camera, User, Lock, LockKeyhole } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Background } from '../../components/layout/Background';
import { Input, InputPassword } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { AvatarCropModal } from '../../components/ui/AvatarCropModal';
import { AvatarModal } from '../../components/ui/AvatarModal';
import { toast } from '../../lib/toast';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import { completeRegistration } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';

interface LocationState {
  registrationToken: string;
  email: string;
}

type AvatarModalState = 'closed' | 'options';

const validationRules = {
  full_name: (v: string) => (!v ? 'Full name is required.' : undefined),
  password: (v: string) =>
    !v ? 'Password is required.' : v.length < 8 ? 'Password must be at least 8 characters.' : undefined,
  confirmPassword: (v: string, all: Record<string, string>) =>
    v !== all.password ? 'Passwords do not match.' : undefined,
};

export default function CompleteProfilePage() {
  const location = useLocation();
  const { registrationToken, email } = (location.state as LocationState) || {
    registrationToken: '',
    email: '',
  };

  const { saveAuthTokens } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [cropImage, setCropImage] = useState('');
  const [avatarModal, setAvatarModal] = useState<AvatarModalState>('closed');

  const { values, errors, loading, updateField, handleSubmit } = useForm(
    { full_name: '', field_of_work: '', password: '', confirmPassword: '' },
    validationRules,
  );

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (cropImage) URL.revokeObjectURL(cropImage);
    };
  }, [avatarPreview, cropImage]);

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
    const nextCropImage = URL.createObjectURL(file);
    setAvatarModal('closed');
    setCropImage(nextCropImage);
  };

  const closeCropModal = () => {
    if (cropImage) URL.revokeObjectURL(cropImage);
    setCropImage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const confirmAvatarCrop = (croppedFile: File) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(croppedFile);
    setAvatarPreview(URL.createObjectURL(croppedFile));
    closeCropModal();
  };

  const openAvatarModal = () => {
    setAvatarModal('options');
  };

  const openAvatarPicker = () => {
    fileInputRef.current?.click();
  };

  const removeAvatar = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview('');
    setAvatarModal('closed');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onSubmit = handleSubmit(async (v) => {
    try {
      const response = await completeRegistration({
        registration_token: registrationToken,
        full_name: v.full_name,
        field_of_work: v.field_of_work,
        password: v.password,
        avatar: avatarFile,
      });
      toast.success('Account created successfully!');
      saveAuthTokens(response.access, response.refresh, '/dashboard', response.tenant_id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Registration failed. Please try again.'));
    }
  });

  if (!registrationToken) {
    return <Navigate to="/signup" replace />;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 overflow-hidden">
      <Background />
      
      <div className="relative w-full max-w-md mx-4 sm:mx-0 z-10">
        <div className="bg-white/60 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl p-8 sm:p-10">
          <div className="max-w-sm w-full mx-auto">
            <Link
              to="/signup"
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-black mb-4
                        font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="leading-none">Back to sign up</span>
            </Link>

            <h2 className="text-2xl font-bold text-gray-800 mb-1">Complete your profile</h2>
            <p className="text-gray-500 text-sm mb-6">
              Registering as <span className="font-semibold text-gray-700">{email}</span>
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
              className="flex flex-col gap-4"
            >
              <button
                type="button"
                onClick={openAvatarModal}
                className="flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-left transition-colors hover:border-black focus:border-black focus:outline-none"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-gray-400">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                    ) : (
                      <Camera className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Avatar</p>
                    <p className="text-xs text-gray-400">Upload and crop a profile image</p>
                  </div>
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleAvatarSelection(event.target.files?.[0])}
              />

              <Input
                id="input-fullname"
                name="full_name"
                autoComplete="name"
                label="Full Name"
                placeholder="Nguyen Van A"
                icon={<User className="w-4 h-4 text-gray-400" />}
                value={values.full_name}
                error={errors.full_name}
                onChange={(e) => updateField('full_name', e.target.value)}
              />
              <Input
                id="input-field"
                name="field_of_work"
                autoComplete="organization-title"
                label="Field of Work"
                placeholder="e.g. Machine Learning"
                icon={<Briefcase className="w-4 h-4 text-gray-400" />}
                value={values.field_of_work}
                onChange={(e) => updateField('field_of_work', e.target.value)}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InputPassword
                  id="input-new-password"
                  name="new-password"
                  autoComplete="new-password"
                  label="Password"
                  placeholder="At least 8 characters"
                  icon={<Lock className="w-4 h-4 text-gray-400" />}
                  value={values.password}
                  error={errors.password}
                  onChange={(e) => updateField('password', e.target.value)}
                />
                <InputPassword
                  id="input-confirm-password"
                  name="confirm-password"
                  autoComplete="new-password"
                  label="Confirm"
                  placeholder="Re-enter password"
                  icon={<LockKeyhole className="w-4 h-4 text-gray-400" />}
                  value={values.confirmPassword}
                  error={errors.confirmPassword}
                  onChange={(e) => updateField('confirmPassword', e.target.value)}
                />
              </div>

              <Button
                id="btn-create-account"
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
                className="mt-6"
              >
                Create account
              </Button>
            </form>
          </div>
        </div>

        <AvatarModal
          open={avatarModal === 'options'}
          avatarPreview={avatarPreview}
          onClose={() => setAvatarModal('closed')}
          onRemove={removeAvatar}
          onChange={openAvatarPicker}
        />

        <AvatarCropModal
          imageSrc={cropImage}
          onClose={closeCropModal}
          onConfirm={confirmAvatarCrop}
          onError={() => toast.error('Unable to crop avatar. Please try another image.')}
        />
      </div>
    </div>
  );
}
