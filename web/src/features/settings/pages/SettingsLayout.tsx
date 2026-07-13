import { Code, UserRound } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '@/shared/ui/PageHeader';

const settingsTabs = [
  { label: 'Profile', to: '/dashboard/settings/profile', icon: UserRound },
  { label: 'Developer', to: '/dashboard/settings/developer', icon: Code },
];

export default function SettingsLayout() {
  return (
    <div className="flex flex-1 flex-col space-y-6">
      <PageHeader title="Settings" tabs={settingsTabs} />

      <Outlet />
    </div>
  );
}
