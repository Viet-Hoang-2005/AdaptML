import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Settings, Trash2, ExternalLink, LineChart, Loader2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

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
    return <div className="p-8">Loading...</div>;
  }

  if (!activeJob) {
    return (
      <div className="flex w-full flex-1 flex-col space-y-6">
        <PageHeader title="Drift Monitoring" />
        <Placeholder
          title="Drift Monitoring"
          description="You haven't configured Drift Monitoring for this model yet."
          icon={<LineChart className="h-6 w-6" />}
          action={
            <Button 
              size="md"
              onClick={() => navigate(`/dashboard/drift-monitoring/${modelId}/new`)}
            >
              Create Drift Monitoring
            </Button>
          }
        />
      </div>
    );
  }

  const columns: ColumnDef<DriftMonitoringResult>[] = [
    {
      accessorKey: 'run_at',
      header: 'Run at',
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{new Date(row.original.run_at).toLocaleString()}</span>,
    },
    {
      accessorKey: 'drift_score',
      header: 'Drift score',
      cell: ({ row }) => <span className="font-mono font-semibold">{(row.original.drift_score * 100).toFixed(1)}%</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <Badge variant={row.original.dataset_drift ? 'danger' : 'success'}>{row.original.dataset_drift ? 'Drift detected' : 'Healthy'}</Badge>,
    },
    {
      id: 'action',
      header: 'Report',
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" icon={<ExternalLink className="h-4 w-4" />} onClick={() => handleViewReport(row.original.report_url)}>View report</Button>
      ),
    },
  ];

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <PageHeader title="Drift Monitoring" />
      
      <PageContent className="p-6 space-y-6">
        <div className="flex flex-col space-y-4">
          <div className="flex justify-between items-start">
            <StepTitle title="Configuration Details" />
            <div className="flex gap-2">
              <IconButton
                label="Edit drift configuration"
                icon={<Settings className="h-5 w-5" />}
                onClick={() => navigate(`/dashboard/drift-monitoring/${modelId}/new`)}
              />
              <IconButton
                label="Delete drift configuration"
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
                {isRunning ? 'Running...' : 'Run Now'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryCard 
              label="Trigger Threshold (Records)" 
              value={activeJob.trigger_threshold.toString()} 
            />
            <SummaryCard 
              label="Reference Data Path" 
              value={activeJob.reference_data_s3_path || 'None'} 
            />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-6 space-y-4">
          {activeRunId && (
            <TerminalLogViewer
              key={activeRunId}
              modelId={modelId}
              driftRunId={activeRunId}
              title="Evidently Drift Run Console"
              onCompleted={() => { void refetchResults(); }}
            />
          )}
          <StepTitle title="Monitoring History" />
          <DataTable
            data={results ?? []}
            columns={columns}
            getRowId={(result) => result.id}
            loading={isLoadingResults}
            pageSize={5}
            emptyMessage="No drift runs yet. Run monitoring to generate the first report."
          />
        </div>


      </PageContent>

      <ConfirmModal
        open={isDeleteModalOpen}
        title="Delete Drift Monitoring Config"
        description="Are you sure you want to delete this configuration? This action cannot be undone."
        confirmText="Delete"
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
