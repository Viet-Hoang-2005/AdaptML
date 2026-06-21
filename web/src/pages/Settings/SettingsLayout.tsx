import { Code, UserRound } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { PageTabs } from '../../components/layout/PageTabs';

const settingsTabs = [
  { label: 'Profile', to: '/dashboard/settings/profile', icon: UserRound },
  { label: 'Developer', to: '/dashboard/settings/developer', icon: Code },
];

export default function SettingsLayout() {
  return (
    <div className="flex flex-1 flex-col space-y-6">
      <div className="flex flex-col gap-2 border-b border-gray-300 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <PageTabs tabs={settingsTabs} />
      </div>

      <Outlet />
    </div>
  );
}
