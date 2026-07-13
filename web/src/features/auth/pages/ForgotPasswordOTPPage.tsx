import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { Button } from '@/shared/ui/Button';
import { OTPInput } from '@/shared/ui/OTPInput';
import { useCountdown } from '@/features/auth/hooks/useCountdown';
import { forgotPasswordOTP, verifyForgotPasswordOTP } from '@/features/auth/api/authApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import { useTranslation } from 'react-i18next';

interface LocationState {
  email: string;
}

export default function ForgotPasswordOTPPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { email } = (location.state as LocationState) || { email: '' };

  const { seconds, isRunning, reset: resetCountdown } = useCountdown(60);
  const [otpValue, setOtpValue] = useState('');
  const [loading, setLoading] = useState(false);

  if (!email) {
    return <Navigate to="/forgot-password" replace />;
  }

  const handleVerify = async (otp?: string) => {
    const code = otp || otpValue;
    if (code.length !== 6) {
      toast.warning(t('otp.invalid'));
      return;
    }

    setLoading(true);
    try {
      const response = await verifyForgotPasswordOTP(email, code);
      toast.success(t('recovery.verified'));
      navigate('/forgot-password/reset', {
        state: { email, resetToken: response.reset_token },
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('otp.expired')));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await forgotPasswordOTP(email);
      toast.success(t('otp.resent'));
      resetCountdown();
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('otp.resendFailed')));
    }
  };

  const handleOTPComplete = (otp: string) => {
    setOtpValue(otp);
    void handleVerify(otp);
  };

  return (
    <AuthCard>
      <div className="max-w-sm w-full mx-auto text-center">
        <Link
          to="/forgot-password"
          className="mb-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground
                    font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="leading-none">{t('otp.back')}</span>
        </Link>

        <div className="mx-auto mb-4 rounded-2xl flex items-center justify-center">
          <Mail className="h-8 w-8 text-foreground" />
        </div>

        <h2 className="mb-2 text-2xl font-bold text-foreground">{t('otp.title')}</h2>
        <p className="mb-8 text-sm text-muted-foreground">
          {t('otp.description', { email })}
        </p>

        <div className="mb-6">
          <OTPInput onComplete={handleOTPComplete} disabled={loading} />
        </div>

        <Button
          id="btn-verify-reset-otp"
          variant="primary"
          fullWidth
          loading={loading}
          onClick={() => handleVerify()}
        >
          {t('otp.verify')}
        </Button>

        <p className="mt-6 text-sm text-muted-foreground">
          {t('otp.missing')}{' '}
          {isRunning ? (
            <span className="font-semibold text-muted-foreground">
              {t('otp.resendIn', { seconds })}
            </span>
          ) : (
            <button
              onClick={handleResend}
              className="cursor-pointer font-semibold text-foreground hover:opacity-60"
            >
              {t('otp.resend')}
            </button>
          )}
        </p>
      </div>
    </AuthCard>
  );
}
