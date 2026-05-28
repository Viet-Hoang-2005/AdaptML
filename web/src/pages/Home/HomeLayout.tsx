import { FlaskConical, UploadCloud } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { PageTabs } from '../../components/layout/PageTabs';

const homeTabs = [
  { label: 'Model API', to: '/dashboard/home/model-api', icon: UploadCloud },
  { label: 'Model Testing', to: '/dashboard/home/model-testing', icon: FlaskConical },
];

export default function HomeLayout() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-gray-300 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-bold text-gray-900">Home</h1>
        <PageTabs tabs={homeTabs} />
      </div>

      <Outlet />
    </div>
  );
}
