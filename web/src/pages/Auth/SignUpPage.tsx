import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, UserPlus } from 'lucide-react';
import { Cover } from '../../components/layout/Cover';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Divider';
import { toast } from '../../lib/toast';
import { requestOTP } from '../../lib/api';
import GoogleIcon from '../../assets/icons/Google.png';
import GitHubIcon from '../../assets/icons/GitHub.png';
import MLdriftLogo from '../../assets/icons/MLdrift.png';

export default function SignUpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

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
    } catch {
      toast.error('Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = () => toast.warning('Google OAuth integration coming soon.');
  const handleGitHubSignUp = () => toast.warning('GitHub OAuth integration coming soon.');

  return (
    <div className="flex min-h-screen bg-white">
      <Cover />

      <div className="w-full lg:w-1/3 flex flex-col justify-center px-8 sm:px-12 lg:px-10 xl:px-14">
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <img src={MLdriftLogo} alt="MLdrift" className="w-10 h-10" />
          <span className="text-2xl font-bold text-gray-800">MLdrift</span>
        </div>

        <div className="max-w-sm w-full mx-auto">
          {/* Icon */}
          <div className="w-16 h-16 mb-2 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
            <UserPlus className="w-8 h-8 text-blue-600" />
          </div>

          <h2 className="text-2xl text-center font-bold text-gray-800 mb-1">Create an account</h2>
          <p className="text-gray-500 text-center text-sm mb-8">Sign up for your account</p>

          {/* OAuth Buttons */}
          <div className="flex gap-3 mb-6">
            <button
              id="btn-google-signup"
              onClick={handleGoogleSignUp}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                         border border-gray-200 rounded-xl hover:bg-gray-100
                         transition-colors duration-200 text-sm font-medium text-gray-700 cursor-pointer"
            >
              <img src={GoogleIcon} alt="Google" className="w-5 h-5" />
              Google
            </button>
            <button
              id="btn-github-signup"
              onClick={handleGitHubSignUp}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                         border border-gray-200 rounded-xl hover:bg-gray-100
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
              label="Email"
              type="email"
              placeholder="abcxyz@gmail.com"
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
              className="mt-2"
            >
              Sign up
            </Button>
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:text-blue-700 font-semibold">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
