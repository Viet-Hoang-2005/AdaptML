import { useGoogleLogin } from '@react-oauth/google';
import { Mail, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { Button } from '@/shared/ui/Button';
import { Divider } from '@/features/auth/components/Divider';
import { Input, InputPassword } from '@/shared/ui/Input';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { startGitHubOAuth } from '@/features/auth/lib/oauth';
import { toast } from '@/shared/ui/toastStore';
import { useForm } from '@/features/auth/hooks/useForm';
import GitHubIcon from '@/assets/icons/GitHub.png';
import GoogleIcon from '@/assets/icons/Google.png';
import MLdriftLogo from '@/assets/icons/MLdrift.png';

function GoogleLoginButton({ onSuccess }: { onSuccess: (accessToken: string) => void }) {
  const openGoogleLogin = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: (tokenResponse) => {
      onSuccess(tokenResponse.access_token);
    },
    onError: () => toast.error('Google login failed. Please try again.'),
  });

  return (
    <button
      id="btn-google-login"
      onClick={() => openGoogleLogin()}
      className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                  text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
    >
      <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
      Google
    </button>
  );
}

export default function LoginPage() {
  const { login, loginWithGoogle, loading } = useAuth();
  const { values, updateField } = useForm({ email: '', password: '' });
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

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

      <h2 className="mb-1 text-center text-2xl font-bold text-foreground">Welcome back</h2>
      <p className="mb-8 text-center text-sm text-muted-foreground">Sign in to your account to continue</p>

      <div className="flex gap-3 mb-6">
        {googleClientId ? (
          <GoogleLoginButton onSuccess={(accessToken) => void loginWithGoogle(accessToken)} />
        ) : (
          <button
            id="btn-google-login"
            onClick={() => toast.error('VITE_GOOGLE_CLIENT_ID is not configured.')}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                        text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
          >
            <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
            Google
          </button>
        )}
        <button
          id="btn-github-login"
          onClick={handleGitHubLogin}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                      text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
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
            className="text-xs font-semibold text-foreground underline hover:opacity-60"
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

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <Link to="/signup" className="font-semibold text-foreground underline hover:opacity-60">
          Sign up
        </Link>
      </p>
    </AuthCard>
  );
}
