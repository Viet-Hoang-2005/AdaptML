import { FlaskConical, UploadCloud } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '@/shared/ui/PageHeader';

const homeTabs = [
  { label: 'Models', to: '/dashboard/home/models', icon: UploadCloud },
  { label: 'Model Testing', to: '/dashboard/home/model-testing', icon: FlaskConical },
];

export default function HomeLayout() {
  return (
    <div className="flex flex-1 flex-col space-y-6">
      <PageHeader title="Home" tabs={homeTabs} />

      <Outlet />
    </div>
  );
}
