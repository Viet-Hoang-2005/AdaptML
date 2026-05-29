import { useGoogleLogin } from '@react-oauth/google';
import { Mail, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AuthCard } from '../../components/layout/AuthCard';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Divider';
import { Input, InputPassword } from '../../components/ui/Input';
import { useAuth } from '../../hooks/useAuth';
import { startGitHubOAuth } from '../../lib/oauth';
import { toast } from '../../lib/toast';
import { useForm } from '../../hooks/useForm';
import GitHubIcon from '../../assets/icons/GitHub.png';
import GoogleIcon from '../../assets/icons/Google.png';
import MLdriftLogo from '../../assets/icons/MLdrift.png';

export default function LoginPage() {
  const { login, loginWithGoogle, loading } = useAuth();
  const { values, updateField } = useForm({ email: '', password: '' });
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  const openGoogleLogin = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: (tokenResponse) => {
      void loginWithGoogle(tokenResponse.access_token);
    },
    onError: () => toast.error('Google login failed. Please try again.'),
  });

  const handleGoogleLogin = () => {
    if (!googleClientId) {
      toast.error('VITE_GOOGLE_CLIENT_ID is not configured.');
      return;
    }
    openGoogleLogin();
  };

  const handleGitHubLogin = () => {
    try {
      startGitHubOAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'GitHub OAuth is not configured.');
    }
  };

  return (
    <AuthCard>
      <div className="rounded-2xl flex items-center justify-center mx-auto mb-2">
        <img src={MLdriftLogo} alt="MLdrift" className="w-8 h-8" />
      </div>

      <h2 className="text-center text-2xl font-bold text-gray-800 mb-1">Welcome back</h2>
      <p className="text-center text-gray-500 text-sm mb-8">Sign in to your account to continue</p>

      <div className="flex gap-3 mb-6">
        <button
          id="btn-google-login"
          onClick={handleGoogleLogin}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                      border border-black rounded-xl hover:border-gray-300 hover:opacity-70
                      transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
        >
          <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
          Google
        </button>
        <button
          id="btn-github-login"
          onClick={handleGitHubLogin}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                      border border-black rounded-xl hover:border-gray-300 hover:opacity-70
                      transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
        >
          <img src={GitHubIcon} alt="GitHub" className="w-5 h-5" />
          GitHub
        </button>
      </div>

      <div className="mb-6">
        <Divider label="or sign in with email" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          login(values);
        }}
        className="flex flex-col gap-4"
      >
        <Input
          id="input-email"
          name="email"
          autoComplete="email"
          label="Email"
          type="email"
          placeholder="example@gmail.com"
          icon={<Mail className="w-4 h-4" />}
          value={values.email}
          onChange={(e) => updateField('email', e.target.value)}
        />

        <InputPassword
          id="input-password"
          name="password"
          autoComplete="current-password"
          label="Password"
          placeholder="••••••••"
          icon={<LockKeyhole className="w-4 h-4" />}
          value={values.password}
          onChange={(e) => updateField('password', e.target.value)}
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-xs text-black hover:opacity-60 underline font-semibold"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          id="btn-login"
          type="submit"
          variant="primary"
          fullWidth
          loading={loading}
          className="mt-2 "
        >
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-8">
        Don't have an account?{' '}
        <Link to="/signup" className="text-black hover:opacity-60 underline font-semibold">
          Sign up
        </Link>
      </p>
    </AuthCard>
  );
}
