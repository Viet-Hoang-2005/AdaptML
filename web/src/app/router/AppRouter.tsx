import { lazy, Suspense } from 'react';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom';
import { RouteFallback } from './RouteFallback';

const AuthLayout = lazy(() => import('@/features/auth/pages/AuthLayout'));
const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage'));
const SignUpPage = lazy(() => import('@/features/auth/pages/SignUpPage'));
const SignUpOTPPage = lazy(() => import('@/features/auth/pages/SignUpOTPPage'));
const CompleteProfilePage = lazy(() => import('@/features/auth/pages/CompleteProfilePage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/pages/ForgotPasswordPage'));
const ForgotPasswordOTPPage = lazy(() => import('@/features/auth/pages/ForgotPasswordOTPPage'));
const ForgotPasswordResetPage = lazy(() => import('@/features/auth/pages/ForgotPasswordResetPage'));
const GitHubCallbackPage = lazy(() => import('@/features/auth/pages/GitHubCallbackPage'));
const ProtectedRoute = lazy(() => import('./ProtectedRoute').then((module) => ({ default: module.ProtectedRoute })));
const DashboardLayout = lazy(() => import('@/app/layouts/DashboardLayout'));
const NotificationsPage = lazy(() => import('@/features/notifications/pages/NotificationsPage'));
const CatalogLayout = lazy(() => import('@/features/catalog/pages/CatalogLayout'));
const ModelProjectPage = lazy(() => import('@/features/catalog/pages/ModelProjectPage'));
const ModelTestingPage = lazy(() => import('@/features/catalog/pages/ModelTestingPage'));
const ModelManagementPage = lazy(() => import('@/features/build-deploy/pages/ModelManagementPage'));
const MetadataPage = lazy(() => import('@/features/build-deploy/pages/MetadataPage'));
const BuildDeployPage = lazy(() => import('@/features/build-deploy/pages/BuildDeployPage'));
const ModelDetailPage = lazy(() => import('@/features/build-deploy/pages/ModelDetailPage'));
const TrainModelPage = lazy(() => import('@/features/training/pages/TrainModelPage'));
const TrainingJobDetailPage = lazy(() => import('@/features/training/pages/TrainingJobDetailPage'));
const CreateTrainingJobPage = lazy(() => import('@/features/training/pages/CreateTrainingJobPage'));
const RegistryPage = lazy(() => import('@/features/registry/pages/RegistryPage'));
const DriftMonitoringPage = lazy(() => import('@/features/drift/pages/DriftMonitoringPage'));
const CreateDriftMonitoringPage = lazy(() => import('@/features/drift/pages/CreateDriftMonitoringPage'));
const DriftReportPage = lazy(() => import('@/features/drift/pages/DriftReportPage'));
const SettingsLayout = lazy(() => import('@/features/settings/pages/SettingsLayout'));
const ProfileSettingPage = lazy(() => import('@/features/settings/pages/ProfileSettingPage'));
const DeveloperSettingPage = lazy(() => import('@/features/settings/pages/DeveloperSettingPage'));
const ApiKeyPage = lazy(() => import('@/features/settings/pages/ApiKeyPage'));

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
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
      <Route
        path="/dashboard"
        element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}
      >
        <Route index element={<Navigate to="home/models" replace />} />
        <Route path="home" element={<CatalogLayout />}>
          <Route index element={<Navigate to="models" replace />} />
          <Route path="models">
            <Route index element={<ModelProjectPage />} />
            <Route path=":modelId" element={<ModelProjectPage />} />
          </Route>
          <Route path="model-testing">
            <Route index element={<ModelTestingPage />} />
            <Route path=":modelId" element={<ModelTestingPage />} />
          </Route>
        </Route>
        <Route path="drift-monitoring">
          <Route index element={<DriftMonitoringPage />} />
          <Route path=":modelId" element={<DriftMonitoringPage />} />
          <Route path=":modelId/new" element={<CreateDriftMonitoringPage />} />
          <Route path=":modelId/report" element={<DriftReportPage />} />
        </Route>
        <Route path="model-training">
          <Route index element={<TrainModelPage />} />
          <Route path="new" element={<CreateTrainingJobPage />} />
          <Route path=":modelId" element={<TrainModelPage />} />
          <Route path=":modelId/new" element={<CreateTrainingJobPage />} />
          <Route path=":modelId/job/:jobId" element={<TrainingJobDetailPage />} />
        </Route>
        <Route path="model-training/:modelId/job/:jobId" element={<TrainingJobDetailPage />} />
        <Route path="model-evolution">
          <Route index element={<RegistryPage />} />
          <Route path=":familyId" element={<RegistryPage />} />
        </Route>
        <Route path="management" element={<ModelManagementPage />} />
        <Route path="management/model/upload" element={<Navigate to="metadata" replace />} />
        <Route path="management/model/upload/metadata" element={<MetadataPage />} />
        <Route path="management/model/upload/build-deploy" element={<BuildDeployPage />} />
        <Route path="management/model/:modelId" element={<Navigate to="information" replace />} />
        <Route path="management/model/:modelId/:tab" element={<ModelDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSettingPage />} />
          <Route path="developer" element={<DeveloperSettingPage />} />
        </Route>
        <Route path="settings/developer/api-keys/create" element={<ApiKeyPage />} />
        <Route path="settings/developer/api-keys/:keyId" element={<ApiKeyPage />} />
        <Route path="*" element={<Navigate to="/dashboard/home/models" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </>,
  ),
);

export function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
