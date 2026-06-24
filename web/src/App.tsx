import { createBrowserRouter, RouterProvider, createRoutesFromElements, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from './components/ui/Toast';
import AuthLayout from './pages/Auth/AuthLayout';
import LoginPage from './pages/Auth/Login/LoginPage';
import SignUpPage from './pages/Auth/SignUp/SignUpPage';
import SignUpOTPPage from './pages/Auth/SignUp/SignUpOTPPage';
import CompleteProfilePage from './pages/Auth/SignUp/CompleteProfilePage';
import ForgotPasswordPage from './pages/Auth/ForgotPassword/ForgotPasswordPage';
import ForgotPasswordOTPPage from './pages/Auth/ForgotPassword/ForgotPasswordOTPPage';
import ForgotPasswordResetPage from './pages/Auth/ForgotPassword/ForgotPasswordResetPage';
import GitHubCallbackPage from './pages/Auth/Login/GitHubCallbackPage';
import { ProtectedRoute } from './pages/Dashboard/ProtectedRoute';
import DashboardLayout from './pages/Dashboard/DashboardLayout';
import HomeLayout from './pages/Home/HomeLayout';
import ModelApiPage from './pages/Home/Api/ModelApiPage';
import ModelTestingPage from './pages/Home/Test/ModelTestingPage';
import APIManagementPage from './pages/Management/APIManagementPage';
import TrainModelPage from './pages/Training/TrainModelPage';
import TrainingJobDetailPage from './pages/Training/TrainingJobDetailPage';
import CreateTrainingJobPage from './pages/Training/CreateTrainingJobPage';
import ModelAPIFormPage from './pages/Management/Upload/UploadModelPage';
import ModelDetailPage from './pages/Management/Detail/ModelDetailPage';
import DeveloperSettingPage from './pages/Settings/Developer/DeveloperSettingPage';
import ProfileSettingPage from './pages/Settings/Profile/ProfileSettingPage';
import ApiKeyPage from './pages/Settings/Developer/ApiKeyPage';
import SettingsLayout from './pages/Settings/SettingsLayout';
import { dashboardPlaceholders } from './pages/Dashboard/DashboardPage';
import DriftMonitoringPage from './pages/Monitoring/DriftMonitoringPage';
import CreateDriftMonitoringPage from './pages/Monitoring/CreateDriftMonitoringPage';
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Auth Routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/signup/verify-otp" element={<SignUpOTPPage />} />
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
        
        {/* Home Routes */}
        <Route path="home" element={<HomeLayout />}>
          <Route index element={<Navigate to="model-api" replace />} />
          <Route path="model-api">
            <Route index element={<ModelApiPage />} />
            <Route path=":modelId" element={<ModelApiPage />} />
          </Route>
          <Route path="model-testing">
            <Route index element={<ModelTestingPage />} />
            <Route path=":modelId" element={<ModelTestingPage />} />
          </Route>
        </Route>

        {/* Drift Monitoring Routes */}
        <Route path="drift-monitoring">
          <Route index element={<DriftMonitoringPage />} />
          <Route path=":modelId" element={<DriftMonitoringPage />} />
          <Route path=":modelId/new" element={<CreateDriftMonitoringPage />} />
        </Route>

        {/* Model Training Routes */}
        <Route path="model-training">
          <Route index element={<TrainModelPage />} />
          <Route path="new" element={<CreateTrainingJobPage />} />
          <Route path=":modelId" element={<TrainModelPage />} />
          <Route path=":modelId/new" element={<CreateTrainingJobPage />} />
          <Route path=":modelId/job/:jobId" element={<TrainingJobDetailPage />} />
        </Route>
        <Route path="model-training/:modelId/job/:jobId" element={<TrainingJobDetailPage />} />

        {/* Model Evolution Routes */}
        <Route path="model-evolution">
          <Route index element={dashboardPlaceholders.modelEvolution} />
          <Route path=":modelId" element={dashboardPlaceholders.modelEvolution} />
        </Route>
        
        {/* API Management Routes */}
        <Route path="api-management" element={<APIManagementPage />} />
        <Route path="api-management/upload" element={<Navigate to="build-package" replace />} />
        <Route path="api-management/upload/build-package" element={<ModelAPIFormPage />} />
        <Route path="api-management/upload/mlflow-zip" element={<ModelAPIFormPage />} />
        <Route path="api-management/:modelId" element={<Navigate to="information" replace />} />
        <Route path="api-management/:modelId/:tab" element={<ModelDetailPage />} />
        
        <Route path="notifications" element={dashboardPlaceholders.notifications} />
        
        {/* Settings Routes */}
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSettingPage />} />
          <Route path="developer" element={<DeveloperSettingPage />} />
        </Route>
        <Route path="settings/developer/api-keys/create" element={<ApiKeyPage />} />
        <Route path="settings/developer/api-keys/:keyId" element={<ApiKeyPage />} />
        <Route path="*" element={<Navigate to="/dashboard/home/model-api" replace />} />
      </Route>

      {/* Default Redirect */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </>
  )
);

function App() {
  return (
    <>
      <ToastContainer />
      <RouterProvider router={router} />
    </>
  );
}

export default App;
