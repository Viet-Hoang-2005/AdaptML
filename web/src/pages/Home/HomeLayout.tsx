import { FlaskConical, UploadCloud } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';

const homeTabs = [
  { label: 'Model API', to: '/dashboard/home/model-api', icon: UploadCloud },
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
