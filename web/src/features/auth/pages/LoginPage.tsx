import { useGoogleLogin } from '@react-oauth/google';
import { Mail, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/app/theme/useTheme';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { Button } from '@/shared/ui/Button';
import { Divider } from '@/features/auth/components/Divider';
import { Input, InputPassword } from '@/shared/ui/Input';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { startGitHubOAuth } from '@/features/auth/lib/oauth';
import { toast } from '@/shared/ui/toastStore';
import { useForm } from '@/features/auth/hooks/useForm';
import GitHubIcon from '@/assets/icons/GitHub.png';
import GitHubDarkIcon from '@/assets/icons/GitHub-Dark.png';
import GoogleIcon from '@/assets/icons/Google.png';
import MLdriftLogo from '@/assets/icons/MLdrift.png';

function GoogleLoginButton({ onSuccess }: { onSuccess: (accessToken: string) => void }) {
  const { t } = useTranslation('auth');
  const openGoogleLogin = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: (tokenResponse) => {
      onSuccess(tokenResponse.access_token);
    },
    onError: () => toast.error(t('login.googleFailed')),
  });

  return (
    <button
      id="btn-google-login"
      onClick={() => openGoogleLogin()}
      className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                  text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
    >
      <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
      {t('login.google')}
    </button>
  );
}

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const { resolvedTheme } = useTheme();
  const { login, loginWithGoogle, loading } = useAuth();
  const { values, updateField } = useForm({ email: '', password: '' });
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  const handleGitHubLogin = () => {
    try {
      startGitHubOAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('login.githubMissing'));
    }
  };

  return (
    <AuthCard>
      <div className="rounded-2xl flex items-center justify-center mx-auto mb-2">
        <img src={MLdriftLogo} alt="MLdrift" className="w-8 h-8" />
      </div>

      <h2 className="mb-1 text-center text-2xl font-bold text-foreground">{t('login.title')}</h2>
      <p className="mb-8 text-center text-sm text-muted-foreground">{t('login.description')}</p>

      <div className="flex gap-3 mb-6">
        {googleClientId ? (
          <GoogleLoginButton onSuccess={(accessToken) => void loginWithGoogle(accessToken)} />
        ) : (
          <button
            id="btn-google-login"
            onClick={() => toast.error(t('login.googleMissing'))}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                        text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
          >
            <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
            {t('login.google')}
          </button>
        )}
        <button
          id="btn-github-login"
          onClick={handleGitHubLogin}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                      text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
        >
          <img src={resolvedTheme === 'dark' ? GitHubDarkIcon : GitHubIcon} alt="GitHub" className="w-5 h-5" />
          {t('login.github')}
        </button>
      </div>

      <div className="mb-6">
        <Divider label={t('login.divider')} />
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
          label={t('login.email')}
          type="email"
          placeholder={t('login.emailPlaceholder')}
          icon={<Mail className="w-4 h-4" />}
          value={values.email}
          onChange={(e) => updateField('email', e.target.value)}
        />

        <InputPassword
          id="input-password"
          name="password"
          autoComplete="current-password"
          label={t('login.password')}
          placeholder={t('login.passwordPlaceholder')}
          icon={<LockKeyhole className="w-4 h-4" />}
          value={values.password}
          onChange={(e) => updateField('password', e.target.value)}
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-xs font-semibold text-foreground underline hover:opacity-60"
          >
            {t('login.forgotPassword')}
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
          {t('login.submit')}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t('login.noAccount')}{' '}
        <Link to="/signup" className="font-semibold text-foreground underline hover:opacity-60">
          {t('login.signUp')}
        </Link>
      </p>
    </AuthCard>
  );
}
