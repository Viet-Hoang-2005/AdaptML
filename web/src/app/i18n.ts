import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    common: {
      actions: {
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        retry: 'Retry',
        createModel: 'Create model',
      },
      navigation: {
        overview: 'Overview',
        buildDeploy: 'Build & Deploy',
        training: 'Training',
        registry: 'Registry',
        monitoring: 'Monitoring',
        notifications: 'Notifications',
        settings: 'Settings',
      },
      states: {
        loading: 'Loading...',
        empty: 'No data available',
        error: 'Something went wrong',
      },
    },
    auth: {
      signIn: { title: 'Welcome back', description: 'Sign in to continue to your workspace.' },
      recovery: { title: 'Recover access', description: 'Reset your account password securely.' },
    },
    catalog: { title: 'Model overview', empty: 'Create or upload a model project to begin.' },
    buildDeploy: {
      title: 'Build & Deploy',
      buildLogs: 'Build console',
      deploymentLogs: 'Deployment console',
    },
    training: { title: 'Training', empty: 'Create a training job to track runtime progress and artifacts.' },
    registry: { title: 'Registry', empty: 'Registered model versions will appear here.' },
    drift: { title: 'Monitoring', empty: 'Configure drift monitoring to compare production and reference data.' },
    settings: { title: 'Settings', apiKeys: 'API keys', profile: 'Profile' },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;
