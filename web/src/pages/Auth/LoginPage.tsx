import { useGoogleLogin } from '@react-oauth/google';
import { Handshake } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Cover } from '../../components/layout/Cover';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Divider';
import { Input, InputPassword } from '../../components/ui/Input';
import { useAuth } from '../../hooks/useAuth';
import GitHubIcon from '../../assets/icons/GitHub.png';
import GoogleIcon from '../../assets/icons/Google.png';
import { startGitHubOAuth } from '../../lib/oauth';
import { toast } from '../../lib/toast';
import { useForm } from '../../hooks/useForm';

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
    <div className="flex min-h-screen bg-white">
      <Cover />
      
      <div className="w-full lg:w-1/3 flex flex-col justify-center px-8 sm:px-12 lg:px-10 xl:px-14">
        <div className="max-w-sm w-full mx-auto">
          <div className="rounded-2xl flex items-center justify-center mx-auto mb-2">
            <Handshake className="w-8 h-8 text-black" />
          </div>

          <h2 className="text-center text-2xl font-bold text-gray-800 mb-1">Welcome back</h2>
          <p className="text-center text-gray-500 text-sm mb-8">Sign in to your account to continue</p>

          <div className="flex gap-3 mb-6">
            <button
              id="btn-google-login"
              onClick={handleGoogleLogin}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                         border border-gray-200 rounded-xl hover:opacity-70
                         transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
            >
              <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
              Google
            </button>
            <button
              id="btn-github-login"
              onClick={handleGitHubLogin}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                         border border-gray-200 rounded-xl hover:opacity-70
                         transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
            >
              <img src={GitHubIcon} alt="GitHub" className="w-5 h-5" />
              GitHub
            </button>
          </div>

          <div className="mb-6">
            <Divider label="or sign in with email" />
          </div>

          <div className="flex flex-col gap-4">
            <Input
              id="input-email"
              label="Email"
              type="email"
              placeholder="abcxyz@gmail.com"
              value={values.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
            <div>
              <InputPassword
                id="input-password"
                label="Password"
                placeholder="********"
                value={values.password}
                onChange={(e) => updateField('password', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login(values)}
              />
              <div className="flex justify-end mt-2">
                <Link
                  to="/forgot-password"
                  className="text-xs text-black hover:opacity-60 underline font-semibold"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button
              id="btn-login"
              variant="primary"
              fullWidth
              loading={loading}
              onClick={() => login(values)}
              className="mt-2"
            >
              Sign in
            </Button>
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            Don't have an account?{' '}
            <Link to="/signup" className="text-black hover:opacity-60 underline font-semibold">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
