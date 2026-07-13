import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { Button } from '@/shared/ui/Button';
import { InputPassword } from '@/shared/ui/Input';
import { useForm } from '@/features/auth/hooks/useForm';
import { resetForgottenPassword } from '@/features/auth/api/authApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';

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
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to reset password. Please request a new OTP.'));
    }
  });

  if (!resetToken) {
    return <Navigate to="/forgot-password" replace />;
  }

  return (
    <AuthCard>
      <div className="max-w-sm w-full mx-auto">
        <Link
          to="/forgot-password"
          className="mb-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground
                    font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="leading-none">Start over</span>
        </Link>

        <div className="mb-4 rounded-2xl flex items-center justify-center mx-auto">
          <LockKeyhole className="h-8 w-8 text-foreground" />
        </div>

        <h2 className="mb-2 text-center text-2xl font-bold text-foreground">Create a new password</h2>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Choose a strong password for{' '}
          <span className="font-semibold text-foreground">{email}</span>.
        </p>

        <div className="flex flex-col gap-4">
          <InputPassword
            id="input-reset-password"
            name="new-password"
            autoComplete="new-password"
            label="New Password"
            placeholder="At least 8 characters"
            value={values.password}
            error={errors.password}
            onChange={(event) => updateField('password', event.target.value)}
          />
          <InputPassword
            id="input-confirm-reset-password"
            name="confirm-password"
            autoComplete="new-password"
            label="Confirm Password"
            placeholder="Re-enter password"
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
    </AuthCard>
  );
}
