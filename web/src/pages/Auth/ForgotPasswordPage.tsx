import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { Cover } from '../../components/layout/Cover';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { forgotPasswordOTP } from '../../lib/api';
import MLdriftLogo from '../../assets/icons/MLdrift.png';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSendOTP = async () => {
    if (!email) {
      toast.warning('Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      await forgotPasswordOTP(email);
      setSent(true);
      toast.success('OTP has been sent to your email!');
    } catch {
      toast.error('Failed to send OTP. Please check your email and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      <Cover />

      <div className="w-full lg:w-1/3 flex flex-col justify-center px-8 sm:px-12 lg:px-10 xl:px-14">
        {/* Mobile Logo */}
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <img src={MLdriftLogo} alt="MLdrift" className="w-10 h-10" />
          <span className="text-2xl font-bold text-gray-800">MLdrift</span>
        </div>

        <div className="max-w-sm w-full mx-auto">
          {/* Back to Login */}
          <Link
            to="/login"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-12
                      font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="leading-none">Back to sign in</span>
          </Link>

          {!sent ? (
            <>
              {/* Icon */}
              <div className="w-16 h-16 mb-4 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
                <Mail className="w-8 h-8 text-blue-600" />
              </div>

              <h2 className="text-2xl text-center font-bold text-gray-800 mb-2">Reset your password</h2>
              <p className="text-center text-gray-500 text-sm mb-6">
                Enter your email and we'll send you a verification code to reset your password.
              </p>

              <div className="flex flex-col gap-4">
                <Input
                  id="input-forgot-email"
                  label="Email"
                  type="email"
                  placeholder="abcxyz@gmail.com"
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
                  className="mt-2"
                >
                  Send OTP
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center">
              {/* Success State */}
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-green-50 flex items-center justify-center">
                <Mail className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Check your email</h2>
              <p className="text-gray-500 text-sm mb-6">
                We've sent a verification code to{' '}
                <span className="font-semibold text-gray-700">{email}</span>.
                Please check your inbox and follow the instructions.
              </p>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setSent(false)}
              >
                Try a different email
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
