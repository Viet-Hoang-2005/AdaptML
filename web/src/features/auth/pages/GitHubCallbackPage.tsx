import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { getGitHubOAuthConfig } from '@/features/auth/lib/oauth';
import { toast } from '@/shared/ui/toastStore';

export default function GitHubCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithGitHubCode } = useAuth();
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    if (hasHandledCallback.current) {
      return;
    }
    hasHandledCallback.current = true;

    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');
    const expectedState = localStorage.getItem('github_oauth_state');

    localStorage.removeItem('github_oauth_state');

    if (!code) {
      toast.error('GitHub did not return an authorization code.');
      navigate('/login', { replace: true });
      return;
    }

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      toast.error('GitHub OAuth state is invalid. Please try again.');
      navigate('/login', { replace: true });
      return;
    }

    const { redirectUri } = getGitHubOAuthConfig();
    void loginWithGitHubCode(code, redirectUri);
  }, [loginWithGitHubCode, navigate, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
      <LoaderCircle className="mb-4 h-8 w-8 animate-spin text-foreground" />
      <p className="text-sm font-medium">Completing GitHub sign in...</p>
    </div>
  );
}
