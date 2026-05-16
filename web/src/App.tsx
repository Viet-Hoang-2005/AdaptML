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
import { ProtectedRoute } from './components/ProtectedRoute';
import DashboardLayout from './pages/Dashboard/DashboardLayout';
import HomeLayout from './pages/Home/HomeLayout';
import DeveloperSettingsPage from './pages/Settings/DeveloperSettingsPage';
import ProfileSettingsPage from './pages/Settings/ProfileSettingsPage';
import SettingsLayout from './pages/Settings/SettingsLayout';
import { dashboardPlaceholders, homePlaceholders } from './pages/Dashboard/DashboardPage';

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
            <Route path="model-api" element={homePlaceholders.modelApi} />
            <Route path="benchmark" element={homePlaceholders.benchmark} />
            <Route path="model-management" element={homePlaceholders.modelManagement} />
          </Route>
          <Route path="drift-monitoring" element={dashboardPlaceholders.driftMonitoring} />
          <Route path="model-training" element={dashboardPlaceholders.modelTraining} />
          <Route path="model-evolution" element={dashboardPlaceholders.modelEvolution} />
          <Route path="notifications" element={dashboardPlaceholders.notifications} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingsPage />} />
            <Route path="developer" element={<DeveloperSettingsPage />} />
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
