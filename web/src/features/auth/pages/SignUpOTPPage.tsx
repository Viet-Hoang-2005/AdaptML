import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { OTPInput } from '@/shared/ui/OTPInput';
import { Button } from '@/shared/ui/Button';
import { toast } from '@/shared/ui/toastStore';
import { useCountdown } from '@/features/auth/hooks/useCountdown';
import { verifyOTP, requestOTP } from '@/features/auth/api/authApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface LocationState {
  email: string;
}

export default function SignUpOTPPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { email } = (location.state as LocationState) || { email: '' };

  const { seconds, isRunning, reset: resetCountdown } = useCountdown(60);

  const [loading, setLoading] = useState(false);
  const [otpValue, setOtpValue] = useState('');

  const handleVerify = async (otp?: string) => {
    const code = otp || otpValue;
    if (code.length !== 6) {
      toast.warning(t('otp.invalid'));
      return;
    }
    setLoading(true);
    try {
      const response = await verifyOTP({ email, otp_code: code });
      toast.success(t('otp.verified'));
      navigate('/signup/complete-profile', {
        state: { registrationToken: response.registration_token, email },
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('otp.expired')));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await requestOTP({ email });
      toast.success(t('otp.resent'));
      resetCountdown(); // Bắt đầu lại bộ đếm 60s
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('otp.resendFailed')));
    }
  };

  const handleOTPComplete = (otp: string) => {
    setOtpValue(otp);
    handleVerify(otp);
  };

  if (!email) {
    navigate('/signup');
    return null;
  }

  return (
    <AuthCard>
      <div className="max-w-sm w-full mx-auto text-center">
        <Link
          to="/signup"
          className="mb-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground
                    font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="leading-none">{t('otp.back')}</span>
        </Link>

        <div className="mx-auto mb-2 rounded-2xl flex items-center justify-center">
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
          id="btn-verify-otp"
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
