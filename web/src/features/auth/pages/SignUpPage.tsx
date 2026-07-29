import { useGoogleLogin } from "@react-oauth/google";
import { Mail, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/app/theme/useTheme";
import { AuthCard } from "@/features/auth/components/AuthCard";
import { Button } from "@/shared/components/Button";
import { Divider } from "@/features/auth/components/Divider";
import { Input } from "@/shared/components/Input";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { requestOTP } from "@/features/auth/api/authApi";
import { getApiErrorMessage } from "@/shared/api/errors";
import { startGitHubOAuth } from "@/features/auth/lib/oauth";
import { toast } from "@/shared/components/toastStore";
import GitHubIcon from "@/assets/icons/GitHub.png";
import GitHubDarkIcon from "@/assets/icons/GitHub-Dark.png";
import GoogleIcon from "@/assets/icons/Google.png";

function GoogleSignUpButton({
  onSuccess,
}: {
  onSuccess: (accessToken: string) => void;
}) {
  const { t } = useTranslation("auth");
  const openGoogleLogin = useGoogleLogin({
    scope: "openid email profile",
    onSuccess: (tokenResponse) => {
      onSuccess(tokenResponse.access_token);
    },
    onError: () => toast.error(t("signup.googleFailed")),
  });

  return (
    <button
      id="btn-google-signup"
      onClick={() => openGoogleLogin()}
      className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                  text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
    >
      <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
      {t("login.google")}
    </button>
  );
}

export default function SignUpPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");
  const { resolvedTheme } = useTheme();
  const { loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  const handleRequestOTP = async () => {
    if (!email) {
      toast.warning(t("signup.emailRequired"));
      return;
    }

    setLoading(true);
    try {
      await requestOTP({ email });
      toast.success(t("signup.otpSent"));
      navigate("/signup/verify-otp", { state: { email } });
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("signup.otpFailed")));
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubSignUp = () => {
    try {
      startGitHubOAuth();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("login.githubMissing"),
      );
    }
  };

  return (
    <AuthCard>
      <div className="mb-2 rounded-2xl flex items-center justify-center mx-auto">
        <UserPlus className="h-8 w-8 text-foreground" />
      </div>

      <h2 className="mb-1 text-center text-2xl font-bold text-foreground">
        {t("signup.title")}
      </h2>
      <p className="mb-8 text-center text-sm text-muted-foreground">
        {t("signup.description")}
      </p>

      <div className="flex gap-3 mb-6">
        {googleClientId ? (
          <GoogleSignUpButton
            onSuccess={(accessToken) => void loginWithGoogle(accessToken)}
          />
        ) : (
          <button
            id="btn-google-signup"
            onClick={() => toast.error(t("login.googleMissing"))}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                        text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
          >
            <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
            {t("login.google")}
          </button>
        )}
        <button
          id="btn-github-signup"
          onClick={handleGitHubSignUp}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3
                      text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary hover:opacity-70"
        >
          <img
            src={resolvedTheme === "dark" ? GitHubDarkIcon : GitHubIcon}
            alt="GitHub"
            className="w-5 h-5"
          />
          {t("login.github")}
        </button>
      </div>

      <div className="mb-6">
        <Divider label={t("signup.divider")} />
      </div>

      <div className="flex flex-col gap-4">
        <Input
          id="input-signup-email"
          name="email"
          autoComplete="email"
          label={t("login.email")}
          type="email"
          placeholder={t("login.emailPlaceholder")}
          icon={<Mail className="w-4 h-4" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleRequestOTP()}
        />

        <Button
          id="btn-signup"
          variant="primary"
          fullWidth
          loading={loading}
          onClick={handleRequestOTP}
          className="mt-4"
        >
          {t("signup.submit")}
        </Button>
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t("signup.hasAccount")}{" "}
        <Link
          to="/login"
          className="font-semibold text-white underline hover:opacity-60"
        >
          {t("signup.signIn")}
        </Link>
      </p>
    </AuthCard>
  );
}
