import { Bell } from 'lucide-react';
import { PageHeader } from '@/shared/ui/PageHeader';
import { StatePanel } from '@/shared/ui/StatePanel';

export default function NotificationsPage() {
  return (
    <section className="flex flex-1 flex-col gap-6">
      <PageHeader title="Notifications" />
      <StatePanel
        title="Notifications are coming soon"
        description="Operational notifications are not part of the current Control Plane contract yet. Build, deployment, training, and drift status remain available in their respective lifecycle pages."
        icon={<Bell className="h-6 w-6" />}
      />
    </section>
  );
}
