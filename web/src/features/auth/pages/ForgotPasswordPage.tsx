import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { Input } from '@/shared/ui/Input';
import { Button } from '@/shared/ui/Button';
import { toast } from '@/shared/ui/toastStore';
import { forgotPasswordOTP } from '@/features/auth/api/authApi';
import { getApiErrorMessage } from '@/shared/api/errors';

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
    <AuthCard>
      <div className="max-w-sm w-full mx-auto">
        {/* Back to Login */}
        <Link
          to="/login"
          className="mb-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground
                    font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="leading-none">Back to sign in</span>
        </Link>

        {/* Icon */}
        <div className="mb-4 rounded-2xl flex items-center justify-center mx-auto">
          <Mail className="h-8 w-8 text-foreground" />
        </div>

        <h2 className="mb-2 text-center text-2xl font-bold text-foreground">Reset your password</h2>
        <p className="mb-6 text-center text-sm text-muted-foreground">
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
            icon={<Mail className="h-4 w-4" />}
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
    </AuthCard>
  );
}
