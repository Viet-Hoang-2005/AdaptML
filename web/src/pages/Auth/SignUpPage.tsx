import { useGoogleLogin } from '@react-oauth/google';
import { Mail, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard } from '../../components/layout/AuthCard';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Divider';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../hooks/useAuth';
import { requestOTP } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { startGitHubOAuth } from '../../lib/oauth';
import { toast } from '../../lib/toast';
import GitHubIcon from '../../assets/icons/GitHub.png';
import GoogleIcon from '../../assets/icons/Google.png';

export default function SignUpPage() {
  const navigate = useNavigate();
  const { loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  const openGoogleLogin = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: (tokenResponse) => {
      void loginWithGoogle(tokenResponse.access_token);
    },
    onError: () => toast.error('Google sign up failed. Please try again.'),
  });

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

  const handleGoogleSignUp = () => {
    if (!googleClientId) {
      toast.error('VITE_GOOGLE_CLIENT_ID is not configured.');
      return;
    }
    openGoogleLogin();
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
        <UserPlus className="w-8 h-8 text-black" />
      </div>

      <h2 className="text-2xl text-center font-bold text-gray-800 mb-1">Create an account</h2>
      <p className="text-gray-500 text-center text-sm mb-8">Sign up for your account</p>

      <div className="flex gap-3 mb-6">
        <button
          id="btn-google-signup"
          onClick={handleGoogleSignUp}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                      border border-gray-300 rounded-xl hover:opacity-70
                      transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
        >
          <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
          Google
        </button>
        <button
          id="btn-github-signup"
          onClick={handleGitHubSignUp}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                      border border-gray-300 rounded-xl hover:opacity-70
                      transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
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

      <p className="text-center text-sm text-gray-500 mt-8">
        Already have an account?{' '}
        <Link to="/login" className="text-black hover:opacity-60 font-semibold underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
