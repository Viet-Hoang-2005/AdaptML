import { useGoogleLogin } from '@react-oauth/google';
import { Mail, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { Button } from '@/shared/ui/Button';
import { Divider } from '@/features/auth/components/Divider';
import { Input } from '@/shared/ui/Input';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { requestOTP } from '@/features/auth/api/authApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { startGitHubOAuth } from '@/features/auth/lib/oauth';
import { toast } from '@/shared/ui/toastStore';
import GitHubIcon from '@/assets/icons/GitHub.png';
import GoogleIcon from '@/assets/icons/Google.png';

function GoogleSignUpButton({ onSuccess }: { onSuccess: (accessToken: string) => void }) {
  const openGoogleLogin = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: (tokenResponse) => {
      onSuccess(tokenResponse.access_token);
    },
    onError: () => toast.error('Google sign up failed. Please try again.'),
  });

  return (
    <button
      id="btn-google-signup"
      onClick={() => openGoogleLogin()}
      className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                  text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
    >
      <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
      Google
    </button>
  );
}

export default function SignUpPage() {
  const navigate = useNavigate();
  const { loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  const handleRequestOTP = async () => {
    if (!email) {
      toast.warning('Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      await requestOTP({ email });
      toast.success('OTP has been sent to your email!');
      navigate('/signup/verify-otp', { state: { email } });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to send OTP. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubSignUp = () => {
    try {
      startGitHubOAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'GitHub OAuth is not configured.');
    }
  };

  return (
    <AuthCard>
      <div className="mb-2 rounded-2xl flex items-center justify-center mx-auto">
        <UserPlus className="h-8 w-8 text-foreground" />
      </div>

      <h2 className="mb-1 text-center text-2xl font-bold text-foreground">Create an account</h2>
      <p className="mb-8 text-center text-sm text-muted-foreground">Sign up for your account</p>

      <div className="flex gap-3 mb-6">
        {googleClientId ? (
          <GoogleSignUpButton onSuccess={(accessToken) => void loginWithGoogle(accessToken)} />
        ) : (
          <button
            id="btn-google-signup"
            onClick={() => toast.error('VITE_GOOGLE_CLIENT_ID is not configured.')}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                        text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
          >
            <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
            Google
          </button>
        )}
        <button
          id="btn-github-signup"
          onClick={handleGitHubSignUp}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                      text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
        >
          <img src={GitHubIcon} alt="GitHub" className="w-5 h-5" />
          GitHub
        </button>
      </div>

      <div className="mb-6">
        <Divider label="or sign up with email" />
      </div>

      <div className="flex flex-col gap-4">
        <Input
          id="input-signup-email"
          name="email"
          autoComplete="email"
          label="Email"
          type="email"
          placeholder="example@gmail.com"
          icon={<Mail className="w-4 h-4" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRequestOTP()}
        />

        <Button
          id="btn-signup"
          variant="primary"
          fullWidth
          loading={loading}
          onClick={handleRequestOTP}
          className="mt-4"
        >
          Sign up
        </Button>
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-foreground underline hover:opacity-60">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
