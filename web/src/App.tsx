import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from './components/ui/Toast';
import LoginPage from './pages/Auth/LoginPage';
import SignUpPage from './pages/Auth/SignUpPage';
import OTPPage from './pages/Auth/OTPPage';
import CompleteProfilePage from './pages/Auth/CompleteProfilePage';
import ForgotPasswordPage from './pages/Auth/ForgotPasswordPage';
import ForgotPasswordOTPPage from './pages/Auth/ForgotPasswordOTPPage';
import ForgotPasswordResetPage from './pages/Auth/ForgotPasswordResetPage';
import GitHubCallbackPage from './pages/Auth/GitHubCallbackPage';
import DashboardPage from './pages/Dashboard/DashboardPage';

function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        {/* Auth Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/signup/verify-otp" element={<OTPPage />} />
        <Route path="/signup/complete-profile" element={<CompleteProfilePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/forgot-password/verify-otp" element={<ForgotPasswordOTPPage />} />
        <Route path="/forgot-password/reset" element={<ForgotPasswordResetPage />} />
        <Route path="/oauth/github/callback" element={<GitHubCallbackPage />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Default Redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
