import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { Background } from '../../components/layout/Background';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { forgotPasswordOTP } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    if (!email) {
      toast.warning('Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const response = await forgotPasswordOTP(email);
      toast.success('OTP has been sent to your email!');
      navigate('/forgot-password/verify-otp', {
        state: { email: response.email || email.trim().toLowerCase() },
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to send OTP. Please check your email and try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 overflow-hidden">
      <Background />
      
      <div className="relative w-full max-w-md mx-4 sm:mx-0 z-10">
        <div className="bg-white/60 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl p-8 sm:p-10">
          <div className="max-w-sm w-full mx-auto">
            {/* Back to Login */}
            <Link
              to="/login"
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-black mb-8
                        font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="leading-none">Back to sign in</span>
            </Link>

            {/* Icon */}
            <div className="mb-4 rounded-2xl flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8 text-black" />
            </div>

            <h2 className="text-2xl text-center font-bold text-gray-800 mb-2">Reset your password</h2>
            <p className="text-center text-gray-500 text-sm mb-6">
              Enter your email and we'll send you a verification code to reset your password.
            </p>

            <div className="flex flex-col gap-4">
              <Input
                id="input-forgot-email"
                name="email"
                autoComplete="email"
                label="Email"
                type="email"
                placeholder="example@gmail.com"
                icon={<Mail className="w-4 h-4 text-gray-400" />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
              />
              <Button
                id="btn-send-otp"
                variant="primary"
                fullWidth
                loading={loading}
                onClick={handleSendOTP}
                className="mt-4"
              >
                Send OTP
              </Button>
            </div>
          </div>
        </div>
      </div>
  </div>
  );
}
