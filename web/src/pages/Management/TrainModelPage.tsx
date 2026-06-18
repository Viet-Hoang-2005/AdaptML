import {
  Clipboard,
  Download,
  FileArchive,
  FileCode2,
  RefreshCw,
  Rocket,
  ScrollText,
  UploadCloud,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  createTrainingJob,
  getTrainingJobDownloadUrl,
  getTrainingJobLogs,
  listTrainingJobs,
  refreshTrainingJobStatus,
} from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import type { TrainingJob, TrainingJobFormValues, TrainingJobStatus } from '../../types/modelApi';
import { FileDropzone, SummaryItem } from './UploadModelFormPage';

const initialForm: TrainingJobFormValues = {
  name: '',
  model_version: '',
  entry_point: 'train.py',
  source_zip: null,
  requirements_file: null,
  training_data: null,
};

const statusStyles: Record<TrainingJobStatus, string> = {
  pending: 'bg-gray-100 text-gray-700 border-gray-200',
  uploading: 'bg-blue-50 text-blue-700 border-blue-100',
  running: 'bg-amber-50 text-amber-700 border-amber-100',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  failed: 'bg-red-50 text-red-700 border-red-100',
};

const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const backendLabel = (backend?: TrainingJob['training_backend']) => backend || 'sagemaker';

export default function TrainModelPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TrainingJobFormValues>(initialForm);
  const [logsByJobId, setLogsByJobId] = useState<Record<number, string>>({});
  const {
    data,
    error: jobsError,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.trainingJobs,
    queryFn: listTrainingJobs,
  });
  const trainingJobs = data?.training_jobs ?? [];

  const invalidateJobs = () => queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs });

  const createMutation = useMutation({
    mutationFn: createTrainingJob,
    onMutate: () => {
      toast.warning('Uploading files and creating training job...');
    },
    onSuccess: async (job) => {
      setForm(initialForm);
      await invalidateJobs();
      toast.success(`Training job ${job.name} ${job.model_version} created on ${backendLabel(job.training_backend)}.`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to create training job. Check training backend configuration.'));
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (job: TrainingJob) => refreshTrainingJobStatus(job.id),
    onMutate: (job) => {
      toast.warning(`Refreshing status for ${job.name}...`);
    },
    onSuccess: async (updatedJob, previousJob) => {
      await invalidateJobs();
      if (updatedJob.status === previousJob.status) {
        toast.success(`Status unchanged: ${statusLabels[updatedJob.status]}.`);
      } else if (updatedJob.status === 'failed') {
        toast.error(`Training job failed. Check the training log for details.`);
      } else {
        toast.success(`Status changed: ${statusLabels[previousJob.status]} -> ${statusLabels[updatedJob.status]}.`);
      }
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to refresh training status. Check backend logs.'));
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (job: TrainingJob) => getTrainingJobDownloadUrl(job.id),
    onSuccess: ({ download_url }, job) => {
      window.open(download_url, '_blank', 'noopener,noreferrer');
      toast.success(`Download link opened for ${job.name}.`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Model artifact is not ready yet. Refresh status first.'));
    },
  });

  const logsMutation = useMutation({
    mutationFn: (job: TrainingJob) => getTrainingJobLogs(job.id),
    onSuccess: ({ logs }, job) => {
      setLogsByJobId((current) => ({ ...current, [job.id]: logs }));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to load training logs.'));
    },
  });

  const setField = (field: keyof TrainingJobFormValues, value: string | File | null) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const copyUri = async (value: string) => {
    if (!value) {
      toast.warning('No S3 URI to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied S3 URI.');
    } catch {
      toast.warning('Unable to copy S3 URI automatically.');
    }
  };

  const canSubmit =
    Boolean(form.name.trim()) &&
    Boolean(form.model_version.trim()) &&
    Boolean(form.entry_point.trim()) &&
    Boolean(form.source_zip) &&
    Boolean(form.training_data);

  return (
    <section className="flex w-full flex-1 flex-col space-y-5">
      <div className="flex flex-col gap-2 border-b border-gray-300 pb-3">
        <h1 className="text-lg font-bold text-gray-900">Model Training</h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-500">
          Upload training code and data, run a backend training job, inspect logs, and download the private model artifact from S3.
        </p>
      </div>

      <div className="rounded-lg border border-gray-300 bg-white p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black text-white">
              <Rocket className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Start training job</h2>
              <p className="text-sm text-gray-500">Source zip must contain the entry point, usually train.py.</p>
            </div>
          </div>
          <span className="w-fit rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600">
            Backend is selected by server config
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
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

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <FileDropzone
            accept=".zip,application/zip"
            title={form.source_zip ? form.source_zip.name : 'Source code zip'}
            subtitle="Required .zip"
            onChange={(file) => setField('source_zip', file)}
          />
          <FileDropzone
            accept=".txt,text/plain"
            title={form.requirements_file ? form.requirements_file.name : 'requirements.txt'}
            subtitle="Optional"
            onChange={(file) => setField('requirements_file', file)}
          />
          <FileDropzone
            accept=".csv,text/csv"
            title={form.training_data ? form.training_data.name : 'Training data CSV'}
            subtitle="Required .csv"
            onChange={(file) => setField('training_data', file)}
          />
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">
          <span className="font-semibold text-gray-800">Training contract:</span> code reads data from{' '}
          <code>SM_CHANNEL_TRAIN</code> and writes model files to <code>SM_MODEL_DIR</code>. The runner packages{' '}
          <code>SM_MODEL_DIR</code> into <code>model.tar.gz</code>.
        </div>

        <div className="mt-4 flex justify-end">
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
        <TrainingJobsSkeleton />
      ) : isError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 p-5">
          <h2 className="text-base font-bold text-red-800">Unable to load training jobs</h2>
          <p className="mt-1 text-sm text-red-700">{getApiErrorMessage(jobsError, 'Please check the control plane API.')}</p>
          <Button className="mt-4" variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : trainingJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
          <FileCode2 className="mx-auto h-8 w-8 text-gray-400" />
          <h2 className="mt-3 text-base font-bold text-gray-900">No training jobs yet</h2>
          <p className="mt-1 text-sm text-gray-500">Submit a source zip and CSV dataset to start your first training job.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">Training jobs</h2>
            {isFetching && <span className="text-xs font-semibold text-gray-400">Refreshing list...</span>}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {trainingJobs.map((job) => (
              <TrainingJobCard
                key={job.id}
                job={job}
                refreshing={refreshMutation.isPending}
                downloading={downloadMutation.isPending}
                loadingLogs={logsMutation.isPending}
                logText={logsByJobId[job.id] || job.training_logs || job.error_message}
                onRefresh={() => refreshMutation.mutate(job)}
                onDownload={() => downloadMutation.mutate(job)}
                onRefreshLogs={() => logsMutation.mutate(job)}
                onCopyUri={copyUri}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TrainingJobsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {[0, 1].map((item) => (
        <div key={item} className="min-h-80 animate-pulse rounded-lg border border-gray-300 bg-white p-5">
          <div className="h-5 w-40 rounded bg-gray-200" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="h-16 rounded bg-gray-100" />
            <div className="h-16 rounded bg-gray-100" />
          </div>
          <div className="mt-4 h-36 rounded bg-gray-950/90" />
        </div>
      ))}
    </div>
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
  onCopyUri,
}: {
  job: TrainingJob;
  refreshing: boolean;
  downloading: boolean;
  loadingLogs: boolean;
  logText?: string;
  onRefresh: () => void;
  onDownload: () => void;
  onRefreshLogs: () => void;
  onCopyUri: (value: string) => void;
}) {
  return (
    <article className="rounded-lg border border-gray-300 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-gray-400">Training Job</p>
          <h2 className="mt-1 truncate text-lg font-bold text-gray-900">{job.name}</h2>
          <p className="mt-1 text-sm text-gray-500">Version {job.model_version}</p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${statusStyles[job.status]}`}>
          {statusLabels[job.status]}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SummaryItem label="Backend" value={backendLabel(job.training_backend)} />
        <SummaryItem label="Entry point" value={job.entry_point || '-'} />
        <SummaryItem label="External job ID" value={job.external_job_id || job.sagemaker_job_name || '-'} />
        <SummaryItem label="Updated" value={job.updated_at ? new Date(job.updated_at).toLocaleString() : '-'} />
      </div>

      <div className="mt-4 space-y-3">
        <UriLine
          icon={<FileArchive className="h-4 w-4" />}
          label="Output URI"
          value={job.output_s3_uri}
          onCopy={onCopyUri}
        />
        <UriLine
          icon={<Download className="h-4 w-4" />}
          label="Artifact URI"
          value={job.model_artifact_uri}
          onCopy={onCopyUri}
        />
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
        <pre className="max-h-64 min-h-40 overflow-y-auto whitespace-pre-wrap p-4 text-xs leading-5 text-gray-100">
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
          Refresh status
        </Button>
        <Button
          size="sm"
          icon={<Download className="h-4 w-4" />}
          disabled={job.status !== 'completed'}
          loading={downloading}
          onClick={onDownload}
        >
          Download model
        </Button>
      </div>
    </article>
  );
}

function UriLine({
  icon,
  label,
  value,
  onCopy,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-400">
          {icon}
          {label}
        </p>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!value}
          onClick={() => onCopy(value)}
          aria-label={`Copy ${label}`}
        >
          <Clipboard className="h-4 w-4" />
        </button>
      </div>
      <code className="block truncate text-xs text-gray-600" title={value || '-'}>
        {value || '-'}
      </code>
    </div>
  );
}
