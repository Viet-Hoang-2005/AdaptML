import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { Cover } from '../../components/layout/Cover';
import { OTPInput } from '../../components/ui/OTPInput';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { useCountdown } from '../../hooks/useCountdown';
import { verifyOTP, requestOTP } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { useState } from 'react';

interface LocationState {
  email: string;
}

export default function OTPPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { email } = (location.state as LocationState) || { email: '' };

  const { seconds, isRunning, reset: resetCountdown } = useCountdown(60);

  const [loading, setLoading] = useState(false);
  const [otpValue, setOtpValue] = useState('');

  const handleVerify = async (otp?: string) => {
    const code = otp || otpValue;
    if (code.length !== 6) {
      toast.warning('Please enter a valid 6-digit code.');
      return;
    }
    setLoading(true);
    try {
      const response = await verifyOTP({ email, otp_code: code });
      toast.success('Email verified successfully!');
      navigate('/signup/complete-profile', {
        state: { registrationToken: response.registration_token, email },
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Invalid or expired OTP. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await requestOTP({ email });
      toast.success('A new OTP has been sent to your email.');
      resetCountdown(); // Bắt đầu lại bộ đếm 60s
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to resend OTP.'));
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
    <div className="flex min-h-screen bg-white">
      <Cover />

      <div className="w-full lg:w-1/3 flex flex-col justify-center px-8 sm:px-12 lg:px-10 xl:px-14">
        <div className="max-w-sm w-full mx-auto text-center">
          <Link
            to="/signup"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-black mb-8
                      font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="leading-none">Back</span>
          </Link>

          <div className="mx-auto mb-2 rounded-2xl flex items-center justify-center">
            <Mail className="w-8 h-8 text-black" />
          </div>

          <h2 className="text-2xl font-bold text-gray-800 mb-2">Verify your email</h2>
          <p className="text-gray-500 text-sm mb-8">
            We've sent a 6-digit code to{' '}
            <span className="font-semibold text-gray-700">{email}</span>
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
            Verify
          </Button>

          <p className="text-sm text-gray-500 mt-6">
            Didn't receive the code?{' '}
            {isRunning ? (
              <span className="text-gray-400 font-semibold">
                Resend in <span className="text-black">{seconds}s</span>
              </span>
            ) : (
              <button
                onClick={handleResend}
                className="text-black hover:opacity-60 font-semibold cursor-pointer"
              >
                Resend code
              </button>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
