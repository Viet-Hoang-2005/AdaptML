import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { Cover } from '../../components/layout/Cover';
import { Button } from '../../components/ui/Button';
import { InputPassword } from '../../components/ui/Input';
import { useForm } from '../../hooks/useForm';
import { resetForgottenPassword } from '../../lib/api';
import { toast } from '../../lib/toast';

interface LocationState {
  email: string;
  resetToken: string;
}

const validationRules = {
  password: (value: string) =>
    !value ? 'Password is required.' : value.length < 8 ? 'Password must be at least 8 characters.' : undefined,
  confirmPassword: (value: string, all: Record<string, string>) =>
    value !== all.password ? 'Passwords do not match.' : undefined,
};

export default function ForgotPasswordResetPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { email, resetToken } = (location.state as LocationState) || {
    email: '',
    resetToken: '',
  };

  const { values, errors, loading, updateField, handleSubmit } = useForm(
    { password: '', confirmPassword: '' },
    validationRules,
  );

  const onSubmit = handleSubmit(async (formValues) => {
    try {
      await resetForgottenPassword(resetToken, formValues.password);
      toast.success('Password reset successfully. Please sign in again.');
      navigate('/login', { replace: true });
    } catch {
      toast.error('Failed to reset password. Please request a new OTP.');
    }
  });

  if (!resetToken) {
    return <Navigate to="/forgot-password" replace />;
  }

  return (
    <div className="flex min-h-screen bg-white">
      <Cover />

      <div className="w-full lg:w-1/3 flex flex-col justify-center px-8 sm:px-12 lg:px-10 xl:px-14">
        <div className="max-w-sm w-full mx-auto">
          <Link
            to="/forgot-password"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-black mb-8
                      font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="leading-none">Start over</span>
          </Link>

          <div className="mb-4 rounded-2xl flex items-center justify-center mx-auto">
            <LockKeyhole className="w-8 h-8 text-black" />
          </div>

          <h2 className="text-2xl text-center font-bold text-gray-800 mb-2">Create a new password</h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            Choose a strong password for{' '}
            <span className="font-semibold text-gray-700">{email}</span>.
          </p>

          <div className="flex flex-col gap-4">
            <InputPassword
              id="input-reset-password"
              label="New Password"
              placeholder="At least 8 characters"
              value={values.password}
              error={errors.password}
              onChange={(event) => updateField('password', event.target.value)}
            />
            <InputPassword
              id="input-confirm-reset-password"
              label="Confirm Password"
              placeholder="Re-enter your password"
              value={values.confirmPassword}
              error={errors.confirmPassword}
              onChange={(event) => updateField('confirmPassword', event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && onSubmit()}
            />
            <Button
              id="btn-reset-password"
              variant="primary"
              fullWidth
              loading={loading}
              onClick={onSubmit}
              className="mt-4"
            >
              Reset password
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
