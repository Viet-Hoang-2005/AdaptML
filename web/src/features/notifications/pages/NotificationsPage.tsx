import { Bell } from 'lucide-react';
import { PageHeader } from '@/shared/ui/PageHeader';
import { StatePanel } from '@/shared/ui/StatePanel';
import { useTranslation } from 'react-i18next';

export default function NotificationsPage() {
  const { t } = useTranslation('notifications');
  return (
    <section className="flex flex-1 flex-col gap-6">
      <PageHeader title={t('title')} />
      <StatePanel
        title={t('comingSoon')}
        description={t('description')}
        icon={<Bell className="h-6 w-6" />}
      />
    </section>
  );
}
