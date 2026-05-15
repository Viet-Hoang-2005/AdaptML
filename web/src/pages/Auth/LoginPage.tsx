import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Cover } from '../../components/layout/Cover';
import { Input, InputPassword } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Divider';
import { toast } from '../../lib/toast';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import GoogleIcon from '../../assets/icons/Google.png';
import GitHubIcon from '../../assets/icons/GitHub.png';
import MLdriftLogo from '../../assets/icons/MLdrift.png';

export default function LoginPage() {
  const { login, loading } = useAuth();
  const { values, updateField } = useForm({ email: '', password: '' });

  // OAuth placeholders – sẽ tích hợp sau
  const [, setOAuthLoading] = useState(false);
  const handleGoogleLogin = () => {
    setOAuthLoading(true);
    toast.warning('Google OAuth integration coming soon.');
    setOAuthLoading(false);
  };
  const handleGitHubLogin = () => {
    setOAuthLoading(true);
    toast.warning('GitHub OAuth integration coming soon.');
    setOAuthLoading(false);
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
          {/* Icon */}
          <div className="w-16 h-16 mb-4 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
            <LogIn className="w-8 h-8 text-blue-600" />
          </div>

          <h2 className="text-center text-2xl font-bold text-gray-800 mb-1">Welcome back</h2>
          <p className="text-center text-gray-500 text-sm mb-8">Sign in to your account to continue</p>

          {/* OAuth Buttons */}
          <div className="flex gap-3 mb-6">
            <button
              id="btn-google-login"
              onClick={handleGoogleLogin}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                         border border-gray-200 rounded-xl hover:bg-gray-100
                         transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
            >
              <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
              Google
            </button>
            <button
              id="btn-github-login"
              onClick={handleGitHubLogin}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                         border border-gray-200 rounded-xl hover:bg-gray-100
                         transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
            >
              <img src={GitHubIcon} alt="GitHub" className="w-5 h-5" />
              GitHub
            </button>
          </div>

          <div className="mb-6">
            <Divider label="or sign in with email" />
          </div>

          {/* Base Auth Form */}
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
                  className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
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
            <Link to="/signup" className="text-blue-600 hover:text-blue-700 font-semibold">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
