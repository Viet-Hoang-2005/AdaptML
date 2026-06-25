import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Settings, Trash2, ExternalLink, LineChart, Loader2 } from 'lucide-react';
import { Table } from 'antd';

import Placeholder from '../../components/layout/Placeholder';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import { PageContent } from '../../components/layout/PageContent';
import { StepTitle } from '../../components/ui/StepTitle';
import { SummaryCard } from '../../components/ui/SummaryCard';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { 
  useDriftMonitoringJobs, 
  useDriftMonitoringResults, 
  useDeleteDriftMonitoringJob, 
  useRunDriftMonitoringJob,
  type DriftMonitoringResult
} from '../../hooks/useDriftMonitoring';

export default function DriftMonitoringPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const navigate = useNavigate();
  
  const { data: jobs, isLoading: isLoadingJobs } = useDriftMonitoringJobs(modelId);
  const activeJob = jobs?.find(j => j.status === 'active');
  
  const { data: results, isLoading: isLoadingResults } = useDriftMonitoringResults(activeJob?.id);
  const { mutate: deleteJob, isPending: isDeleting } = useDeleteDriftMonitoringJob();
  const { mutate: runJob, isPending: isRunning } = useRunDriftMonitoringJob();
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

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
      <div className="flex w-full flex-1 flex-col">
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

  const columns = [
    {
      title: 'Run At',
      dataIndex: 'run_at',
      key: 'run_at',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: 'Drift Score',
      dataIndex: 'drift_score',
      key: 'drift_score',
      render: (score: number) => `${(score * 100).toFixed(1)}%`,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, record: DriftMonitoringResult) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
          record.dataset_drift 
            ? 'bg-red-50 text-red-700 border-red-200' 
            : 'bg-green-50 text-green-700 border-green-200'
        }`}>
          {record.dataset_drift ? 'Drift Detected' : 'Healthy'}
        </span>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: DriftMonitoringResult) => (
        <button 
          className="text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium transition-colors"
          onClick={() => handleViewReport(record.report_url)}
        >
          <ExternalLink className="w-4 h-4" />
          <span>View Report</span>
        </button>
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
              <button
                className='w-10 h-10 flex items-center justify-center'
                onClick={() => navigate(`/dashboard/drift-monitoring/${modelId}/new`)}
              >
                <Settings className="w-6 h-6 text-black hover:text-gray-500" />
              </button>
              <button
                className="w-10 h-10 flex items-center justify-center"
                onClick={() => setIsDeleteModalOpen(true)}
              >
                <Trash2 className="w-6 h-6 text-red-600 hover:text-red-400" />
              </button>
              
              <Button 
                size="md"
                onClick={() => runJob({ id: activeJob.id, model_id: modelId! })}
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
          <StepTitle title="Monitoring History" />
          <Table 
            dataSource={results} 
            columns={columns} 
            rowKey="id" 
            loading={isLoadingResults}
            pagination={{ pageSize: 5 }}
            className="border border-gray-200 rounded-lg overflow-hidden"
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
