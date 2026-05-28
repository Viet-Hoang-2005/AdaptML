import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from './components/ui/Toast';
import AuthLayout from './pages/Auth/AuthLayout';
import LoginPage from './pages/Auth/LoginPage';
import SignUpPage from './pages/Auth/SignUpPage';
import OTPPage from './pages/Auth/OTPPage';
import CompleteProfilePage from './pages/Auth/CompleteProfilePage';
import ForgotPasswordPage from './pages/Auth/ForgotPasswordPage';
import ForgotPasswordOTPPage from './pages/Auth/ForgotPasswordOTPPage';
import ForgotPasswordResetPage from './pages/Auth/ForgotPasswordResetPage';
import GitHubCallbackPage from './pages/Auth/GitHubCallbackPage';
import { ProtectedRoute } from './pages/Dashboard/ProtectedRoute';
import DashboardLayout from './pages/Dashboard/DashboardLayout';
import HomeLayout from './pages/Home/HomeLayout';
import ModelApiPage from './pages/Home/ModelApiPage';
import ModelTestingPage from './pages/Home/ModelTestingPage';
import APIManagementPage from './pages/Management/APIManagementPage';
import ModelAPIFormPage from './pages/Management/ModelAPIFormPage';
import DeveloperSettingPage from './pages/Settings/DeveloperSettingPage';
import ProfileSettingPage from './pages/Settings/ProfileSettingPage';
import SettingsLayout from './pages/Settings/SettingsLayout';
import { dashboardPlaceholders } from './pages/Dashboard/DashboardPage';

function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        {/* Auth Routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/signup/verify-otp" element={<OTPPage />} />
          <Route path="/signup/complete-profile" element={<CompleteProfilePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/forgot-password/verify-otp" element={<ForgotPasswordOTPPage />} />
          <Route path="/forgot-password/reset" element={<ForgotPasswordResetPage />} />
          <Route path="/oauth/github/callback" element={<GitHubCallbackPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="home/model-api" replace />} />
          <Route path="home" element={<HomeLayout />}>
            <Route index element={<Navigate to="model-api" replace />} />
            <Route path="model-api" element={<ModelApiPage />} />
            <Route path="model-testing" element={<ModelTestingPage />} />
            <Route path="benchmark" element={<Navigate to="/dashboard/home/model-testing" replace />} />
            <Route path="model-management" element={<Navigate to="/dashboard/api-management" replace />} />
          </Route>
          <Route path="api-management" element={<APIManagementPage />} />
          <Route path="api-management/upload" element={<ModelAPIFormPage />} />
          <Route path="api-management/:modelId" element={<ModelAPIFormPage />} />
          <Route path="drift-monitoring" element={dashboardPlaceholders.driftMonitoring} />
          <Route path="model-training" element={dashboardPlaceholders.modelTraining} />
          <Route path="model-evolution" element={dashboardPlaceholders.modelEvolution} />
          <Route path="notifications" element={dashboardPlaceholders.notifications} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingPage />} />
            <Route path="developer" element={<DeveloperSettingPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard/home/model-api" replace />} />
        </Route>

        {/* Default Redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
