import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Settings, Trash2, ExternalLink, LineChart, Loader2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';

import Placeholder from '@/features/catalog/components/ModelPlaceholder';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageContent } from '@/shared/ui/PageContent';
import { StepTitle } from '@/shared/ui/StepTitle';
import { SummaryCard } from '@/shared/ui/SummaryCard';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { TerminalLogViewer } from '@/shared/ui/TerminalLogViewer';
import { DataTable } from '@/shared/ui/DataTable';
import { Badge } from '@/shared/ui/Badge';
import { IconButton } from '@/shared/ui/IconButton';
import { 
  useDriftMonitoringJobs, 
  useDriftMonitoringResults, 
  useDeleteDriftMonitoringJob, 
  useRunDriftMonitoringJob,
  type DriftMonitoringResult
} from '@/features/drift/hooks/useDriftMonitoring';

export default function DriftMonitoringPage() {
  const { t, i18n } = useTranslation('drift');
  const { modelId } = useParams<{ modelId: string }>();
  const navigate = useNavigate();
  
  const { data: jobs, isLoading: isLoadingJobs } = useDriftMonitoringJobs(modelId);
  const activeJob = jobs?.find(j => j.status === 'active');
  
  const { data: results, isLoading: isLoadingResults, refetch: refetchResults } = useDriftMonitoringResults(activeJob?.id);
  const { mutate: deleteJob, isPending: isDeleting } = useDeleteDriftMonitoringJob();
  const { mutateAsync: runJob, isPending: isRunning } = useRunDriftMonitoringJob();
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const handleRunNow = async () => {
    if (!modelId || !activeJob) return;
    const run = await runJob({ id: activeJob.id, model_id: modelId });
    setActiveRunId(run.id);
  };

  const handleViewReport = (reportUrl: string) => {
    navigate(`/dashboard/drift-monitoring/${modelId}/report`, { 
      state: { reportS3Uri: reportUrl } 
    });
  };

  if (isLoadingJobs) {
    return <div className="p-8">{t('loading')}</div>;
  }

  if (!activeJob) {
    return (
      <div className="flex w-full flex-1 flex-col space-y-6">
        <PageHeader title={t('title')} />
        <Placeholder
          title={t('title')}
          description={t('notConfigured')}
          icon={<LineChart className="h-6 w-6" />}
          action={
            <Button 
              size="md"
              onClick={() => navigate(`/dashboard/drift-monitoring/${modelId}/new`)}
            >
              {t('createMonitoring')}
            </Button>
          }
        />
      </div>
    );
  }

  const columns: ColumnDef<DriftMonitoringResult>[] = [
    {
      accessorKey: 'run_at',
      header: t('runAt'),
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{new Date(row.original.run_at).toLocaleString(i18n.language)}</span>,
    },
    {
      accessorKey: 'drift_score',
      header: t('driftScore'),
      cell: ({ row }) => <span className="font-mono font-semibold">{(row.original.drift_score * 100).toFixed(1)}%</span>,
    },
    {
      id: 'status',
      header: t('status'),
      cell: ({ row }) => <Badge variant={row.original.dataset_drift ? 'danger' : 'success'}>{row.original.dataset_drift ? t('driftDetected') : t('healthy')}</Badge>,
    },
    {
      id: 'action',
      header: t('report'),
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" icon={<ExternalLink className="h-4 w-4" />} onClick={() => handleViewReport(row.original.report_url)}>{t('viewReport')}</Button>
      ),
    },
  ];

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <PageHeader title={t('title')} />
      
      <PageContent className="p-6 space-y-6">
        <div className="flex flex-col space-y-4">
          <div className="flex justify-between items-start">
            <StepTitle title={t('configuration')} />
            <div className="flex gap-2">
              <IconButton
                label={t('edit')}
                icon={<Settings className="h-5 w-5" />}
                onClick={() => navigate(`/dashboard/drift-monitoring/${modelId}/new`)}
              />
              <IconButton
                label={t('delete')}
                variant="danger-outline"
                icon={<Trash2 className="h-5 w-5" />}
                onClick={() => setIsDeleteModalOpen(true)}
              />
              
              <Button 
                size="md"
                onClick={handleRunNow}
                disabled={isRunning}
                className="flex items-center ml-2 gap-2"
              >
                {isRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isRunning ? t('running') : t('run')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryCard 
              label={t('trigger')}
              value={activeJob.trigger_threshold.toString()} 
            />
            <SummaryCard 
              label={t('referencePath')}
              value={activeJob.reference_data_s3_path || t('none')}
            />
          </div>
        </div>

        <div className="border-t border-border pt-6 space-y-4">
          {activeRunId && (
            <TerminalLogViewer
              key={activeRunId}
              modelId={modelId}
              driftRunId={activeRunId}
              title={t('console')}
              onCompleted={() => { void refetchResults(); }}
            />
          )}
          <StepTitle title={t('history')} />
          <DataTable
            data={results ?? []}
            columns={columns}
            getRowId={(result) => result.id}
            loading={isLoadingResults}
            pageSize={5}
            emptyMessage={t('noRuns')}
          />
        </div>


      </PageContent>

      <ConfirmModal
        open={isDeleteModalOpen}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmText={t('deleteConfirm')}
        tone="danger"
        loading={isDeleting}
        onConfirm={() => {
          deleteJob({ id: activeJob.id, model_id: modelId! });
          setIsDeleteModalOpen(false);
        }}
        onCancel={() => setIsDeleteModalOpen(false)}
      />
    </div>
  );
}
