import { Download, FileArchive, FileCode2, RefreshCw, Rocket, ScrollText, UploadCloud } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  createTrainingJob,
  getTrainingJobLogs,
  getTrainingJobDownloadUrl,
  listTrainingJobs,
  refreshTrainingJobStatus,
} from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import type { TrainingJob, TrainingJobFormValues, TrainingJobStatus } from '../../types/modelApi';
import { FileDropzone, SummaryItem } from './UploadModelFormPage';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const initialForm: TrainingJobFormValues = {
  name: '',
  model_version: '',
  entry_point: 'train.py',
  source_zip: null,
  requirements_file: null,
  training_data: null,
};

const statusStyles: Record<TrainingJobStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  uploading: 'bg-blue-50 text-blue-700',
  running: 'bg-amber-50 text-amber-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
};

export default function TrainModelPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TrainingJobFormValues>(initialForm);
  const [logsByJobId, setLogsByJobId] = useState<Record<number, string>>({});
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.trainingJobs,
    queryFn: listTrainingJobs,
  });
  const trainingJobs = data?.training_jobs ?? [];

  useEffect(() => {
    setLogsByJobId((current) => {
      let next = current;
      for (const job of trainingJobs) {
        if (!next[job.id] && (job.training_logs || job.error_message)) {
          if (next === current) {
            next = { ...current };
          }
          next[job.id] = job.training_logs || job.error_message;
        }
      }
      return next;
    });
  }, [trainingJobs]);

  const invalidateJobs = () => queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs });

  const createMutation = useMutation({
    mutationFn: createTrainingJob,
    onSuccess: async () => {
      setForm(initialForm);
      await invalidateJobs();
      toast.success('SageMaker training job submitted.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to submit SageMaker training job.'));
    },
  });

  const refreshMutation = useMutation({
    mutationFn: refreshTrainingJobStatus,
    onSuccess: async () => {
      await invalidateJobs();
      toast.success('Training status refreshed.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to refresh training status.'));
    },
  });

  const downloadMutation = useMutation({
    mutationFn: getTrainingJobDownloadUrl,
    onSuccess: ({ download_url }) => {
      window.open(download_url, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Model artifact is not ready to download.'));
    },
  });

  const logsMutation = useMutation({
    mutationFn: getTrainingJobLogs,
    onSuccess: ({ logs }, jobId) => {
      setLogsByJobId((current) => ({ ...current, [jobId]: logs }));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to load training logs.'));
    },
  });

  const setField = (field: keyof TrainingJobFormValues, value: string | File | null) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const canSubmit =
    Boolean(form.name.trim()) &&
    Boolean(form.model_version.trim()) &&
    Boolean(form.entry_point.trim()) &&
    Boolean(form.source_zip) &&
    Boolean(form.training_data);

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      <div className="flex flex-col gap-2 border-b border-gray-300 pb-3">
        <h1 className="text-lg font-bold text-gray-900">Model Training</h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-500">
          Submit source code, dependencies, and training data to SageMaker. Completed jobs expose a private presigned model artifact URL.
        </p>
      </div>

      <div className="rounded-lg border border-gray-300 bg-white p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black text-white">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Start SageMaker training</h2>
            <p className="text-sm text-gray-500">Source zip must contain the configured entry point.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label="Model name"
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder="CICIDS Classifier"
          />
          <Input
            label="Model version"
            value={form.model_version}
            onChange={(event) => setField('model_version', event.target.value)}
            placeholder="v1"
          />
          <Input
            label="Entry point"
            value={form.entry_point}
            onChange={(event) => setField('entry_point', event.target.value)}
            placeholder="train.py"
          />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <FileDropzone
            accept=".zip,application/zip"
            title={form.source_zip ? form.source_zip.name : 'Upload source code zip'}
            subtitle=".zip"
            onChange={(file) => setField('source_zip', file)}
          />
          <FileDropzone
            accept=".txt,text/plain"
            title={form.requirements_file ? form.requirements_file.name : 'Upload requirements.txt'}
            subtitle="Optional"
            onChange={(file) => setField('requirements_file', file)}
          />
          <FileDropzone
            accept=".csv,text/csv"
            title={form.training_data ? form.training_data.name : 'Upload training data'}
            subtitle=".csv"
            onChange={(file) => setField('training_data', file)}
          />
        </div>

        <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-600">
          The training script should read data from <code>SM_CHANNEL_TRAIN</code> and save the final model to <code>SM_MODEL_DIR</code>.
          SageMaker packages <code>SM_MODEL_DIR</code> as <code>model.tar.gz</code>.
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            size="md"
            icon={<UploadCloud className="h-4 w-4" />}
            disabled={!canSubmit}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate(form)}
          >
            Submit training job
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="min-h-48 rounded-lg border border-gray-300 bg-white" />
      ) : trainingJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
          <FileCode2 className="mx-auto h-8 w-8 text-gray-400" />
          <h2 className="mt-3 text-base font-bold text-gray-900">No training jobs</h2>
          <p className="mt-1 text-sm text-gray-500">Submitted SageMaker jobs will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {trainingJobs.map((job) => (
            <TrainingJobCard
              key={job.id}
              job={job}
              refreshing={refreshMutation.isPending}
              downloading={downloadMutation.isPending}
              loadingLogs={logsMutation.isPending}
              logText={logsByJobId[job.id] || job.training_logs || job.error_message}
              onRefresh={() => refreshMutation.mutate(job.id)}
              onDownload={() => downloadMutation.mutate(job.id)}
              onRefreshLogs={() => logsMutation.mutate(job.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TrainingJobCard({
  job,
  refreshing,
  downloading,
  loadingLogs,
  logText,
  onRefresh,
  onDownload,
  onRefreshLogs,
}: {
  job: TrainingJob;
  refreshing: boolean;
  downloading: boolean;
  loadingLogs: boolean;
  logText?: string;
  onRefresh: () => void;
  onDownload: () => void;
  onRefreshLogs: () => void;
}) {
  return (
    <article className="rounded-lg border border-gray-300 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">SageMaker Training</p>
          <h2 className="mt-2 text-lg font-bold text-gray-900">{job.name}</h2>
          <p className="mt-1 text-sm text-gray-500">{job.model_version}</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold capitalize ${statusStyles[job.status]}`}>
          {job.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SummaryItem label="Entry point" value={job.entry_point || '-'} />
        <SummaryItem label="Backend" value={job.training_backend || 'sagemaker'} />
        <SummaryItem label="External job" value={job.external_job_id || job.sagemaker_job_name || '-'} />
      </div>

      <div className="mt-4 space-y-3">
        <UriLine icon={<FileArchive className="h-4 w-4" />} label="Output" value={job.output_s3_uri} />
        <UriLine icon={<Download className="h-4 w-4" />} label="Artifact" value={job.model_artifact_uri} />
      </div>

      {job.error_message && (
        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
          {job.error_message}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
        <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-300">
            <ScrollText className="h-4 w-4" />
            Training Log
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            loading={loadingLogs}
            onClick={onRefreshLogs}
          >
            Refresh logs
          </Button>
        </div>
        <pre className="max-h-56 min-h-36 overflow-y-auto whitespace-pre-wrap p-4 text-xs leading-5 text-gray-100">
          {logText || 'No training logs are available yet. Refresh logs after the job starts.'}
        </pre>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="h-4 w-4" />}
          loading={refreshing}
          onClick={onRefresh}
        >
          Refresh
        </Button>
        <Button
          size="sm"
          icon={<Download className="h-4 w-4" />}
          disabled={job.status !== 'completed'}
          loading={downloading}
          onClick={onDownload}
        >
          Download
        </Button>
      </div>
    </article>
  );
}

function UriLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-gray-400">
        {icon}
        {label}
      </p>
      <code className="block truncate text-xs text-gray-600">{value || '-'}</code>
    </div>
  );
}
