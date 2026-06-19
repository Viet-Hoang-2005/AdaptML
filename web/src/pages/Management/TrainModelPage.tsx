import { Link } from 'react-router-dom';
import {
  Eye,
  Archive,
  AlertTriangle,
  Clock3,
  Cpu,
  Download,
  FileCode2,
  FileText,
  HardDrive,
  RefreshCw,
  Rocket,
  UploadCloud,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  createTrainingJob,
  getTrainingJobDownloadUrl,
  getTrainingUsage,
  listTrainingJobs,
  refreshTrainingJobStatus,
  } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import { downloadSampleTrainingTemplate } from '../../lib/trainingTemplate';
import { inspectZipFile, readZipEntryText, rebuildZipWithEditedEntry } from '../../lib/trainingZip';
import type {
  TrainingAcceleratorType,
  TrainingJob,
  TrainingJobFormValues,
  TrainingJobStatus,
} from '../../types/modelApi';
import { SummaryItem } from './UploadModelFormPage';

const initialForm: TrainingJobFormValues = {
  name: '',
  model_version: '',
  entry_point: 'train.py',
  vcpu: 2,
  memory: 4096,
  max_runtime_seconds: 3600,
  accelerator_type: 'none',
  accelerator_count: 0,
  source_zip: null,
  requirements_file: null,
  training_data: null,
};

const runtimeProfiles = [
  { id: 'small', label: 'Small', helper: 'Cheaper', vcpu: 1, memory: 2048 },
  { id: 'medium', label: 'Medium', helper: 'Recommended', vcpu: 2, memory: 4096 },
  { id: 'large', label: 'Large', helper: 'More memory', vcpu: 4, memory: 8192 },
] as const;

const runtimeOptions = [
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
  { label: '2h', value: 7200 },
  { label: '6h', value: 21600 },
  { label: '12h', value: 43200 },
];

const acceleratorOptions: Array<{
  label: string;
  type: TrainingAcceleratorType;
  count: number;
  disabled?: boolean;
  helper: string;
}> = [
  { label: 'No accelerator', type: 'none', count: 0, helper: 'CPU/Fargate queue' },
  { label: 'GPU x1', type: 'gpu', count: 1, disabled: true, helper: 'Requires AWS Batch EC2 GPU queue' },
  { label: 'GPU x2', type: 'gpu', count: 2, disabled: true, helper: 'Requires AWS Batch EC2 GPU queue' },
  { label: 'GPU x4', type: 'gpu', count: 4, disabled: true, helper: 'Requires AWS Batch EC2 GPU queue' },
  { label: 'TPU', type: 'tpu', count: 1, disabled: true, helper: 'Coming soon' },
  { label: 'Trainium', type: 'trainium', count: 1, disabled: true, helper: 'Coming soon' },
];



const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const backendLabel = (backend?: TrainingJob['training_backend']) => backend || 'sagemaker';

const jobLabel = (job: Pick<TrainingJob, 'name' | 'model_version'>) => `${job.name} ${job.model_version}`.trim();

const acceleratorSummary = (type?: TrainingAcceleratorType, count?: number) => {
  if (!type || type === 'none' || !count) return 'No accelerator';
  return `${type.toUpperCase()} x${count}`;
};

const AUTO_SYNC_INTERVAL_MS = 4000;
const ACTIVE_STATUSES: TrainingJobStatus[] = ['pending', 'uploading', 'running'];

const formatDuration = (seconds?: number | null) => {
  const totalSeconds = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
};



const elapsedForJob = (job: TrainingJob) => {
  if (job.runtime_seconds) return job.runtime_seconds;
  if (job.status === 'running' && job.started_at) {
    return Math.max(Math.floor((Date.now() - new Date(job.started_at).getTime()) / 1000), 0);
  }
  return 0;
};

const isActiveJob = (job: TrainingJob) => ACTIVE_STATUSES.includes(job.status);

const normalizeZipPath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

const resolveEntryPointPath = (fileNames: string[], entryPoint: string) => {
  const normalizedEntry = normalizeZipPath(entryPoint || 'train.py');
  if (fileNames.includes(normalizedEntry)) {
    return { path: normalizedEntry, exact: true };
  }

  const basename = normalizedEntry.split('/').pop();
  const matches = fileNames.filter((name) => !name.endsWith('/') && name.split('/').pop() === basename);
  if (matches.length === 1) {
    return { path: matches[0], exact: false };
  }

  return { path: '', exact: false };
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
};

const formatFileSize = (file?: File | null) => {
  if (!file) return '';
  if (file.size < 1024) return `${file.size} B`;
  if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
  return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
};

const transitionToast = (previousJob: TrainingJob, updatedJob: TrainingJob) => {
  if (previousJob.status === updatedJob.status) return;
  const wasStarting = ['pending', 'uploading'].includes(previousJob.status);
  if (wasStarting && updatedJob.status === 'running') {
    toast.success(`${jobLabel(updatedJob)} started.`);
    return;
  }
  if (previousJob.status === 'running' && updatedJob.status === 'completed') {
    toast.success(`${jobLabel(updatedJob)} completed in ${formatDuration(elapsedForJob(updatedJob))}.`);
    return;
  }
  if (previousJob.status === 'running' && updatedJob.status === 'failed') {
    const reason = updatedJob.stop_reason || updatedJob.error_message || 'Check the training log for details.';
    toast.error(`${jobLabel(updatedJob)} failed: ${reason}`);
  }
};

type JobVisibilityFilter = 'active' | 'archived' | 'all';
type JobSortMode = 'newest' | 'oldest' | 'status' | 'name';

interface SourceZipState {
  inspecting: boolean;
  fileNames: string[];
  entryExists: boolean;
  requirementsInZip: boolean;
  editable: boolean;
  error: string;
  warning: string;
  resolvedEntryPoint: string;
  entryText: string;
  previewLoading: boolean;
}

const emptySourceZipState: SourceZipState = {
  inspecting: false,
  fileNames: [],
  entryExists: false,
  requirementsInZip: false,
  editable: false,
  error: '',
  warning: '',
  resolvedEntryPoint: '',
  entryText: '',
  previewLoading: false,
};

const statusRank: Record<TrainingJobStatus, number> = {
  running: 0,
  uploading: 1,
  pending: 2,
  failed: 3,
  completed: 4,
};

const sortTrainingJobs = (jobs: TrainingJob[], sortMode: JobSortMode) => {
  const nextJobs = [...jobs];
  if (sortMode === 'oldest') {
    return nextJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  if (sortMode === 'status') {
    return nextJobs.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.id - a.id);
  }
  if (sortMode === 'name') {
    return nextJobs.sort((a, b) => `${a.name} ${a.model_version}`.localeCompare(`${b.name} ${b.model_version}`));
  }
  return nextJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

const upsertTrainingJob = (jobs: TrainingJob[], job: TrainingJob) => {
  const existingIndex = jobs.findIndex((item) => item.id === job.id);
  if (existingIndex === -1) {
    return [job, ...jobs];
  }

  const nextJobs = [...jobs];
  nextJobs[existingIndex] = job;
  return nextJobs;
};

const removeTrainingJob = (jobs: TrainingJob[], jobId: number) => jobs.filter((item) => item.id !== jobId);

const createOptimisticTrainingJob = (payload: TrainingJobFormValues, id: number): TrainingJob => {
  const now = new Date().toISOString();
  return {
    id,
    name: payload.name.trim() || 'Training job',
    model_version: payload.model_version.trim() || 'version',
    entry_point: payload.entry_point.trim() || 'train.py',
    training_backend: 'aws_batch',
    vcpu: payload.vcpu,
    memory: payload.memory,
    max_runtime_seconds: payload.max_runtime_seconds,
    accelerator_type: payload.accelerator_type,
    accelerator_count: payload.accelerator_count,
    source_zip: payload.source_zip?.name || '',
    requirements_file: payload.requirements_file?.name || '',
    training_data: payload.training_data?.name || '',
    s3_source_uri: '',
    s3_training_data_uri: '',
    sagemaker_job_name: '',
    external_job_id: '',
    output_s3_uri: '',
    model_artifact_uri: '',
    status: 'uploading',
    error_message: '',
    training_logs: 'Uploading files and creating training job...',
    started_at: null,
    completed_at: null,
    runtime_seconds: 0,
    stop_reason: '',
    deleted_at: null,
    is_deleted: false,
    created_at: now,
    updated_at: now,
  };
};

export default function TrainModelPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TrainingJobFormValues>(initialForm);
        const [sourceZipState, setSourceZipState] = useState<SourceZipState>(emptySourceZipState);
  const [editedEntryText, setEditedEntryText] = useState('');
  const [entryEdited, setEntryEdited] = useState(false);
  const [preparingSubmit, setPreparingSubmit] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [visibilityFilter, setVisibilityFilter] = useState<JobVisibilityFilter>('active');
  const [sortMode, setSortMode] = useState<JobSortMode>('newest');
  const statusNotificationRef = useRef<Record<number, TrainingJobStatus>>({});
  const {
    data,
    error: jobsError,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.trainingJobs,
    queryFn: () => listTrainingJobs(true),
  });
  const { data: usage, isLoading: isUsageLoading } = useQuery({
    queryKey: queryKeys.trainingUsage,
    queryFn: getTrainingUsage,
    refetchInterval: 15000,
  });
  const allTrainingJobs = useMemo(() => data?.training_jobs ?? [], [data?.training_jobs]);
  const activeTrainingJobs = useMemo(
    () => allTrainingJobs.filter((job) => !job.is_deleted && job.id > 0 && isActiveJob(job)),
    [allTrainingJobs],
  );
  const filteredTrainingJobs = allTrainingJobs.filter((job) => {
    if (visibilityFilter === 'archived') return job.is_deleted;
    if (visibilityFilter === 'active') return !job.is_deleted;
    return true;
  });
  const trainingJobs = sortTrainingJobs(filteredTrainingJobs, sortMode);

  const invalidateJobs = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs }),
    [queryClient],
  );
  const invalidateUsage = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.trainingUsage }),
    [queryClient],
  );

  useEffect(() => {
    const syncableJobs = activeTrainingJobs;

    if (syncableJobs.length === 0) {
      return undefined;
    }

    let cancelled = false;

    const intervalId = window.setInterval(async () => {
      for (const job of syncableJobs) {
        if (cancelled) break;
        try {
          const res = await refreshTrainingJobStatus(job.id);
          const updated = Array.isArray(res) ? res[0] : res;
          queryClient.setQueryData(queryKeys.trainingJobs, (oldData: { training_jobs: TrainingJob[] } | undefined) => {
            if (!oldData?.training_jobs) return oldData;
            return {
              ...oldData,
              training_jobs: upsertTrainingJob(oldData.training_jobs, updated),
            };
          });

          if (statusNotificationRef.current[job.id] && statusNotificationRef.current[job.id] !== updated.status) {
            transitionToast({ ...job, status: statusNotificationRef.current[job.id] }, updated);
          }
          statusNotificationRef.current[job.id] = updated.status;
        } catch {
          // ignore
        }
      }
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTrainingJobs, queryClient]);

  useEffect(() => {
    const sourceZip = form.source_zip;
    const entryPoint = form.entry_point.trim() || 'train.py';
    if (!sourceZip) {
      return undefined;
    }

    let cancelled = false;

    const inspectSource = async () => {
      try {
        if (!sourceZip.name.toLowerCase().endsWith('.zip')) {
          throw new Error('source_zip must be a .zip file.');
        }
        const inspection = await withTimeout(
          inspectZipFile(sourceZip),
          4000,
          'Timed out while reading source.zip. The file may be too large or malformed.',
        );
        const fileNames = inspection.fileNames;
        if (fileNames.length === 0) {
          throw new Error('source.zip was inspected but no files were found.');
        }

        const hasTemplateBundle = fileNames.includes('source.zip') && !fileNames.some((name) => name.split('/').pop() === 'train.py');
        if (hasTemplateBundle) {
          const templateError = 'You uploaded the template bundle. Extract it and upload the inner source.zip, or use the included train.csv/requirements.txt separately.';
          if (cancelled) return;
          setSourceZipState({
            ...emptySourceZipState,
            inspecting: false,
            fileNames,
            error: templateError,
          });
          setEditedEntryText('');
          setEntryEdited(false);
          toast.error(templateError);
          return;
        }

        const resolved = resolveEntryPointPath(fileNames, entryPoint);
        const entryExists = Boolean(resolved.path);
        const requirementsInZip = inspection.fileNames.some((name) => name.split('/').pop()?.toLowerCase() === 'requirements.txt');
        const autoSelectWarning = entryExists && !resolved.exact ? `Entry point was auto-selected as ${resolved.path}.` : '';

        if (cancelled) return;
        setSourceZipState({
          ...emptySourceZipState,
          inspecting: false,
          fileNames,
          entryExists,
          requirementsInZip,
          warning: autoSelectWarning,
          resolvedEntryPoint: resolved.path,
          previewLoading: entryExists,
        });
        setEditedEntryText('');
        setEntryEdited(false);

        if (entryExists && !resolved.exact) {
          setForm((current) => ({ ...current, entry_point: resolved.path }));
        }

        if (!entryExists) {
          return;
        }

        try {
          const entryText = await withTimeout(
            readZipEntryText(sourceZip, resolved.path),
            4000,
            `Preview timed out while reading ${resolved.path}. You can still submit the original zip if the entry point is valid.`,
          );
          if (entryText.includes('\u0000')) {
            throw new Error(`${resolved.path} looks binary or is not UTF-8 text.`);
          }
          if (cancelled) return;
          setSourceZipState((current) => ({
            ...current,
            editable: true,
            entryText,
            previewLoading: false,
          }));
          setEditedEntryText(entryText);
          setEntryEdited(false);
        } catch (error) {
          const warning = getApiErrorMessage(error, 'Entry point exists, but cannot be previewed in this browser.');
          console.warn('Source zip entry preview failed:', warning);
          if (cancelled) return;
          setSourceZipState((current) => ({
            ...current,
            warning,
            previewLoading: false,
          }));
        }
      } catch (error) {
        const message = getApiErrorMessage(error, 'Unable to inspect source.zip.');
        console.warn('Source zip inspection failed:', message);
        toast.error(message);
        if (cancelled) return;
        setSourceZipState({
          ...emptySourceZipState,
          inspecting: false,
          error: message,
        });
        setEditedEntryText('');
        setEntryEdited(false);
      } finally {
        if (!cancelled) {
          setSourceZipState((current) => (current.inspecting ? { ...current, inspecting: false } : current));
        }
      }
    };

    void inspectSource();
    return () => {
      cancelled = true;
    };
  }, [form.source_zip, form.entry_point]);

  const createMutation = useMutation({
    mutationFn: createTrainingJob,
    onMutate: async (payload) => {
      const optimisticId = -Date.now();
      const optimisticJob = createOptimisticTrainingJob(payload, optimisticId);

      await queryClient.cancelQueries({ queryKey: queryKeys.trainingJobs });
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], optimisticJob),
      }));

      toast.warning(`Uploading files and creating training job for ${jobLabel(optimisticJob)}...`);
      return { optimisticId };
    },
    onSuccess: async (job, _payload, context) => {
      setForm(initialForm);
      setSourceZipState(emptySourceZipState);
      setEditedEntryText('');
      setEntryEdited(false);
      setIsCreateOpen(false);
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => {
        const withoutOptimistic = context?.optimisticId
          ? removeTrainingJob(current?.training_jobs ?? [], context.optimisticId)
          : current?.training_jobs ?? [];
        return { training_jobs: upsertTrainingJob(withoutOptimistic, job) };
      });
      void invalidateJobs();
      void invalidateUsage();
      toast.success(`Training job ${jobLabel(job)} created on ${backendLabel(job.training_backend)}.`);
    },
    onError: (error, payload, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
          training_jobs: removeTrainingJob(current?.training_jobs ?? [], context.optimisticId),
        }));
      }
      toast.error(
        `${jobLabel({ name: payload.name, model_version: payload.model_version })}: ${getApiErrorMessage(
          error,
          'Unable to create training job. Check training backend configuration.',
        )}`,
      );
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (job: TrainingJob) => refreshTrainingJobStatus(job.id),
    onMutate: (job) => {
      toast.warning(`Refreshing status for ${jobLabel(job)}...`);
    },
    onSuccess: async (updatedJob, previousJob) => {
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], updatedJob),
      }));
      void invalidateJobs();
      void invalidateUsage();
      if (updatedJob.status === previousJob.status) {
        toast.success(`${jobLabel(updatedJob)} status unchanged: ${statusLabels[updatedJob.status]}.`);
      } else if (updatedJob.status === 'failed') {
        const reason = updatedJob.stop_reason || updatedJob.error_message || 'Check the training log for details.';
        toast.error(`${jobLabel(updatedJob)} failed: ${reason}`);
      } else {
        toast.success(
          `${jobLabel(updatedJob)} status changed: ${statusLabels[previousJob.status]} -> ${statusLabels[updatedJob.status]}.`,
        );
      }
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to refresh training status. Check backend logs.')}`);
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (job: TrainingJob) => getTrainingJobDownloadUrl(job.id),
    onSuccess: ({ download_url }, job) => {
      window.open(download_url, '_blank', 'noopener,noreferrer');
      toast.success(`Download link opened for ${jobLabel(job)}.`);
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Model artifact is not ready yet. Refresh status first.')}`);
    },
  });

  
  
  
  
  const setField = (field: keyof TrainingJobFormValues, value: string | number | File | null) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === 'entry_point' && form.source_zip) {
      setSourceZipState((current) => ({ ...current, inspecting: true, error: '', warning: '' }));
    }
  };

  const setSourceZip = (file: File | null) => {
    setField('source_zip', file);
    if (!file) {
      setSourceZipState(emptySourceZipState);
      setEditedEntryText('');
      setEntryEdited(false);
      return;
    }
    setSourceZipState({ ...emptySourceZipState, inspecting: true });
  };

  const selectRuntimeProfile = (vcpu: number, memory: number) => {
    setForm((current) => ({ ...current, vcpu, memory }));
  };



  const validateBeforeSubmit = () => {
    if (!form.source_zip) return 'Source code zip is required.';
    if (!form.training_data) return 'Training data CSV is required.';
    if (!form.source_zip.name.toLowerCase().endsWith('.zip')) return 'source_zip must be a .zip file.';
    if (!form.training_data.name.toLowerCase().endsWith('.csv')) return 'training_data must be a .csv file.';
    if (!form.entry_point.trim()) return 'Entry point is required.';
    if (sourceZipState.inspecting) return 'Source zip is still being inspected.';
    if (sourceZipState.error) return sourceZipState.error;
    if (!sourceZipState.entryExists) return `Entry point ${form.entry_point || 'train.py'} was not found in source.zip.`;
    if (form.accelerator_type !== 'none') {
      return 'GPU/TPU/Trainium training is not enabled for the current CPU/Fargate queue.';
    }
    if (usage && form.max_runtime_seconds > usage.remaining_seconds) {
      return `Monthly quota exceeded. Remaining quota is ${formatDuration(usage.remaining_seconds)}.`;
    }
    return '';
  };

  const submitTrainingJob = async () => {
    const validationError = validateBeforeSubmit();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    let sourceZip = form.source_zip;
    if (sourceZip && entryEdited && sourceZipState.editable) {
      try {
        setPreparingSubmit(true);
        sourceZip = await rebuildZipWithEditedEntry(sourceZip, form.entry_point.trim() || 'train.py', editedEntryText);
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Unable to rebuild source.zip with edited entry point.'));
        setPreparingSubmit(false);
        return;
      } finally {
        setPreparingSubmit(false);
      }
    }

    createMutation.mutate({ ...form, source_zip: sourceZip });
  };

  const canSubmit =
    Boolean(form.name.trim()) &&
    Boolean(form.model_version.trim()) &&
    Boolean(form.entry_point.trim()) &&
    Boolean(form.source_zip) &&
    !sourceZipState.inspecting &&
    !sourceZipState.error &&
    sourceZipState.entryExists &&
    Boolean(form.training_data) &&
    form.source_zip?.name.toLowerCase().endsWith('.zip') &&
    form.training_data?.name.toLowerCase().endsWith('.csv') &&
    form.accelerator_type === 'none' &&
    (!usage || form.max_runtime_seconds <= usage.remaining_seconds);

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Model Training</h1>
          <p className="mt-1 text-sm text-gray-500">
            Train, monitor, and manage model training runs.
          </p>
        </div>
        <Button
          icon={<Rocket className="h-4 w-4" />}
          onClick={() => setIsCreateOpen(true)}
        >
          New Training Job
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Monthly Training Quota</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  {isUsageLoading ? '...' : formatDuration(usage?.monthly_runtime_seconds)}
                </span>
                <span className="text-sm font-medium text-gray-500">
                  / {formatDuration(usage?.monthly_quota_seconds || 43200)} used
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Remaining</p>
              <p className={`mt-1 text-lg font-bold ${
                usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.1) 
                  ? 'text-red-600' 
                  : usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.3) 
                    ? 'text-amber-600' 
                    : 'text-emerald-600'
              }`}>
                {isUsageLoading ? '...' : formatDuration(usage?.remaining_seconds)}
              </p>
            </div>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.1) 
                  ? 'bg-red-500' 
                  : usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.3) 
                    ? 'bg-amber-500' 
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, ((usage?.monthly_runtime_seconds || 0) / (usage?.monthly_quota_seconds || 1)) * 100)}%` }}
            />
          </div>
        </div>

        <div className={`flex flex-col justify-center rounded-xl border p-5 shadow-sm transition-colors ${
          (usage?.running_jobs_count || 0) > 0 
            ? 'border-blue-200 bg-blue-50/50' 
            : 'border-gray-200 bg-white'
        }`}>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
            <Rocket className="h-4 w-4" />
            Active Jobs
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${
              (usage?.running_jobs_count || 0) > 0 ? 'text-blue-700' : 'text-gray-900'
            }`}>
              {usage?.running_jobs_count ?? 0}
            </span>
            {(usage?.running_jobs_count || 0) > 0 && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500"></span>
              </span>
            )}
          </div>
        </div>
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-6">
          <div id="start-training-section" className="w-full max-w-6xl rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-gray-800 to-black text-white shadow-md">
              <Rocket className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-gray-900">Configure Training Job</h2>
              <p className="text-sm text-gray-500">Upload code, select resources, and start your experiment.</p>
            </div>
          </div>
          <span className="w-fit rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600">
            Backend is selected by server config
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<X className="h-4 w-4" />}
            onClick={() => setIsCreateOpen(false)}
          >
            Close
          </Button>
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
          <TrainingFilePicker
            accept=".zip,application/zip"
            label="Source code zip"
            required
            expected=".zip"
            file={form.source_zip}
            valid={Boolean(form.source_zip?.name.toLowerCase().endsWith('.zip'))}
            onChange={setSourceZip}
          />
          <TrainingFilePicker
            accept=".txt,text/plain"
            label="requirements.txt"
            expected=".txt"
            file={form.requirements_file}
            valid={!form.requirements_file || form.requirements_file.name.toLowerCase().endsWith('.txt')}
            onChange={(file) => setField('requirements_file', file)}
          />
          <TrainingFilePicker
            accept=".csv,text/csv"
            label="Training data CSV"
            required
            expected=".csv"
            file={form.training_data}
            valid={Boolean(form.training_data?.name.toLowerCase().endsWith('.csv'))}
            onChange={(file) => setField('training_data', file)}
          />
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Validation Summary</p>
          <UploadSummary
            sourceZip={form.source_zip}
            requirementsFile={form.requirements_file}
            trainingData={form.training_data}
            sourceZipState={sourceZipState}
          />
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <FileCode2 className="h-4 w-4" />
                Source workspace
              </h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Inspect the uploaded zip, verify the entry point, and make a small edit before submit.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={() => void downloadSampleTrainingTemplate()}
            >
              Download sample template
            </Button>
          </div>

          {!form.source_zip ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
              Select a source.zip to preview its files and validate the entry point.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="space-y-3">
                <SourceValidationRow
                  label="Source zip"
                  ok={form.source_zip.name.toLowerCase().endsWith('.zip')}
                  message={form.source_zip.name.toLowerCase().endsWith('.zip') ? form.source_zip.name : 'Must be a .zip file'}
                />
                <SourceValidationRow
                  label="Entry point"
                  ok={sourceZipState.entryExists}
                  pending={sourceZipState.inspecting}
                  message={
                    sourceZipState.inspecting
                      ? 'Inspecting...'
                      : sourceZipState.entryExists
                        ? `${sourceZipState.resolvedEntryPoint || form.entry_point || 'train.py'} found`
                        : `${form.entry_point || 'train.py'} was not found`
                  }
                />
                <SourceValidationRow
                  label="requirements.txt"
                  ok={sourceZipState.requirementsInZip || Boolean(form.requirements_file)}
                  warning
                  pending={sourceZipState.inspecting}
                  message={
                    sourceZipState.requirementsInZip
                      ? 'Found inside zip'
                      : form.requirements_file
                        ? 'Using uploaded requirements file'
                        : 'Missing. Job can still run if dependencies are already in the image.'
                  }
                />
                {sourceZipState.error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800 shadow-sm flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                    <div>
                      <p className="font-bold">Inspection Error</p>
                      <p className="mt-0.5 text-red-700">{sourceZipState.error}</p>
                    </div>
                  </div>
                )}
                {sourceZipState.warning && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 shadow-sm flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="font-bold">Warning</p>
                      <p className="mt-0.5 text-amber-700">{sourceZipState.warning}</p>
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-gray-200 bg-gray-950 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-gray-300">
                    <FileText className="h-4 w-4" />
                    Files
                  </p>
                  <div className="max-h-48 overflow-auto font-mono text-xs text-gray-100">
                    {sourceZipState.fileNames.length === 0 ? (
                      <p className="text-gray-400">No files inspected yet.</p>
                    ) : (
                      sourceZipState.fileNames.map((name) => (
                        <div key={name} className="truncate py-1" title={name}>
                          {name}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase text-gray-400">Entry point editor</p>
                  {entryEdited && (
                    <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                      Edited
                    </span>
                  )}
                </div>
                {sourceZipState.previewLoading ? (
                  <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-blue-200 bg-blue-50 p-6 text-center text-sm font-semibold text-blue-700">
                    Loading entry point preview...
                  </div>
                ) : sourceZipState.editable ? (
                  <textarea
                    value={editedEntryText}
                    onChange={(event) => {
                      setEditedEntryText(event.target.value);
                      setEntryEdited(event.target.value !== sourceZipState.entryText);
                    }}
                    spellCheck={false}
                    className="min-h-80 w-full resize-y rounded-lg border border-gray-300 bg-gray-950 p-4 font-mono text-xs leading-5 text-gray-100 outline-none focus:border-black"
                  />
                ) : (
                  <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
                    {sourceZipState.entryExists
                      ? sourceZipState.warning || 'Entry point exists but cannot be previewed. You can still submit the original zip.'
                      : 'Choose a zip that contains the configured entry point to preview and edit train.py.'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Training configuration</h3>
              <p className="text-xs text-gray-500">AWS Batch uses fixed Fargate-safe profiles for this MVP.</p>
            </div>
            <span className="w-fit rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600">
              Training backend: {backendLabel(usage?.training_backend)}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {runtimeProfiles.map((profile) => {
              const selected = form.vcpu === profile.vcpu && form.memory === profile.memory;
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={`relative rounded-xl border p-4 text-left transition-all ${
                    selected ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-500 shadow-md' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                  onClick={() => selectRuntimeProfile(profile.vcpu, profile.memory)}
                >
                  {selected && (
                    <div className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-base font-bold text-gray-900">{profile.label}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${
                      profile.helper === 'Recommended' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {profile.helper}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-gray-500">
                    <span className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-gray-100 shadow-sm">
                      <Cpu className="h-3.5 w-3.5 text-gray-400" />
                      {profile.vcpu} vCPU
                    </span>
                    <span className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md border border-gray-100 shadow-sm">
                      <HardDrive className="h-3.5 w-3.5 text-gray-400" />
                      {profile.memory / 1024} GB
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-sm font-semibold text-gray-700">
              Max runtime
              <select
                className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
                value={form.max_runtime_seconds}
                onChange={(event) => setField('max_runtime_seconds', Number(event.target.value))}
              >
                {runtimeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <SummaryItem label="Selected profile" value={`${form.vcpu} vCPU / ${form.memory / 1024} GB`} />
            <SummaryItem label="Requested runtime" value={formatDuration(form.max_runtime_seconds)} />
          </div>
          <div className="mt-5 border-t border-gray-200 pt-4">
            <div className="mb-3">
              <h3 className="text-sm font-bold text-gray-900">Accelerator</h3>
              <p className="text-xs text-gray-500">
                Current AWS Batch queue is CPU/Fargate. GPU requires a separate EC2 GPU Batch environment.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {acceleratorOptions.map((option) => {
                const selected = form.accelerator_type === option.type && form.accelerator_count === option.count;
                return (
                  <button
                    key={`${option.type}-${option.count}`}
                    type="button"
                    disabled={option.disabled}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected
                        ? 'border-black bg-white shadow-sm'
                        : option.disabled
                          ? 'cursor-not-allowed border-gray-200 bg-gray-100 opacity-60'
                          : 'border-gray-200 bg-white hover:border-gray-400'
                    }`}
                    onClick={() => {
                      if (!option.disabled) {
                        setForm((current) => ({
                          ...current,
                          accelerator_type: option.type,
                          accelerator_count: option.count,
                        }));
                      }
                    }}
                  >
                    <p className="text-sm font-bold text-gray-900">{option.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{option.helper}</p>
                  </button>
                );
              })}
            </div>
            {form.accelerator_type === 'gpu' ? (
              <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                GPU requires an EC2 GPU AWS Batch compute environment. Current queue is CPU/Fargate.
              </p>
            ) : (
              <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
                Accelerator selection: {acceleratorSummary(form.accelerator_type, form.accelerator_count)}
              </p>
            )}
          </div>
          {usage && form.max_runtime_seconds > usage.remaining_seconds && (
            <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              Monthly quota exceeded. Remaining quota is {formatDuration(usage.remaining_seconds)}, but this job requests{' '}
              {formatDuration(form.max_runtime_seconds)}.
            </p>
          )}
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
            loading={createMutation.isPending || preparingSubmit}
            onClick={submitTrainingJob}
          >
            Submit training job
          </Button>
        </div>
          </div>
        </div>
      )}

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
      ) : allTrainingJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
          <FileCode2 className="mx-auto h-8 w-8 text-gray-400" />
          <h2 className="mt-3 text-base font-bold text-gray-900">No training jobs yet</h2>
          <p className="mt-1 text-sm text-gray-500">Submit a source zip and CSV dataset to start your first training job.</p>
          <Button className="mt-4" icon={<Rocket className="h-4 w-4" />} onClick={() => setIsCreateOpen(true)}>
            Create your first training job
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-gray-300 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Training history</h2>
              <p className="mt-1 text-xs text-gray-500">
                {trainingJobs.length} shown / {allTrainingJobs.length} total
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedFilter value={visibilityFilter} onChange={setVisibilityFilter} />
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                Sort
                <select
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as JobSortMode)}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="status">Status</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            {isFetching && <span className="text-xs font-semibold text-gray-400">Refreshing list...</span>}
          </div>
          {trainingJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
              <Archive className="mx-auto h-7 w-7 text-gray-400" />
              <h2 className="mt-3 text-sm font-bold text-gray-900">No jobs match this view</h2>
              <p className="mt-1 text-sm text-gray-500">Change the filter to Active, Archived, or All.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trainingJobs.map((job) => (
                <TrainingJobRow
                  key={job.id}
                  job={job}
                  refreshing={refreshMutation.isPending}
                  downloading={downloadMutation.isPending}
                  onRefresh={() => refreshMutation.mutate(job)}
                  onDownload={() => downloadMutation.mutate(job)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SegmentedFilter({
  value,
  onChange,
}: {
  value: JobVisibilityFilter;
  onChange: (value: JobVisibilityFilter) => void;
}) {
  const options: Array<{ label: string; value: JobVisibilityFilter }> = [
    { label: 'Active', value: 'active' },
    { label: 'Archived', value: 'archived' },
    { label: 'All', value: 'all' },
  ];

  return (
    <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`h-7 rounded-md px-3 text-xs font-bold ${
            value === option.value ? 'bg-black text-white' : 'text-gray-500 hover:bg-white hover:text-gray-900'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}



function TrainingFilePicker({
  label,
  expected,
  accept,
  file,
  valid,
  required = false,
  onChange,
}: {
  label: string;
  expected: string;
  accept: string;
  file: File | null;
  valid: boolean;
  required?: boolean;
  onChange: (file: File | null) => void;
}) {
  const inputId = `training-file-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const [isDragActive, setIsDragActive] = useState(false);
  const isSelected = Boolean(file);
  const isValid = isSelected && valid;
  const status = isSelected ? (valid ? 'Selected' : 'Invalid') : required ? 'Missing' : 'Optional';
  
  const containerClass = isDragActive
    ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50/50 scale-[1.02]'
    : isSelected
      ? isValid
        ? 'border-emerald-200 ring-1 ring-emerald-100 bg-emerald-50/30'
        : 'border-red-300 ring-1 ring-red-100 bg-red-50/50'
      : 'border-dashed border-gray-300 hover:border-blue-400 bg-gray-50/50 hover:bg-blue-50 transition-colors';

  const statusClass = isSelected
    ? isValid
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-red-100 text-red-700'
    : required
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-200 text-gray-600';

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onChange(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      className={`relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-200 ease-in-out ${containerClass}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">{label}</p>
            <p className="mt-1 text-xs text-gray-500">{required ? `Required ${expected}` : `Optional ${expected}`}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase shadow-sm ${statusClass}`}>{status}</span>
        </div>

        {file ? (
          <div className={`mt-4 rounded-lg border p-3 shadow-sm transition-all ${isValid ? 'border-emerald-200 bg-white' : 'border-red-200 bg-white'}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isValid ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                {isValid ? <FileCode2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${isValid ? 'text-gray-900' : 'text-red-900'}`} title={file.name}>
                  {file.name}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{formatFileSize(file)}</p>
              </div>
            </div>
          </div>
        ) : (
          <label htmlFor={inputId} className="mt-4 flex min-h-[100px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-5 text-center hover:bg-blue-50 hover:border-blue-300 transition-colors group">
            <div className="rounded-full bg-blue-100 p-2 text-blue-600 group-hover:bg-blue-200 group-hover:scale-110 transition-transform">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Click to upload or drag and drop</p>
              <p className="text-xs text-gray-500 mt-1">Accepts {accept.split(',').map(a => a.split('/')[0]).join(', ')}</p>
            </div>
          </label>
        )}
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {file && (
          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
        {file && (
          <label
            htmlFor={inputId}
            className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-sm transition-all hover:shadow-md ${
              isSelected 
                ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50' 
                : 'border-transparent bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Replace
          </label>
        )}
        <input
          id={inputId}
          key={file?.name || 'empty'}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}

function UploadSummary({
  sourceZip,
  requirementsFile,
  trainingData,
  sourceZipState,
}: {
  sourceZip: File | null;
  requirementsFile: File | null;
  trainingData: File | null;
  sourceZipState: SourceZipState;
}) {
  const entryStatus = sourceZipState.inspecting
    ? 'inspecting'
    : sourceZipState.error
      ? 'error'
      : sourceZipState.entryExists
        ? 'found'
        : sourceZip
          ? 'missing'
          : 'missing';

  return (
    <div className="grid gap-3 text-sm md:grid-cols-4">
      <UploadSummaryItem label="Source zip" status={sourceZip ? 'selected' : 'missing'} detail={sourceZip?.name || 'Missing'} />
      <UploadSummaryItem
        label="Requirements"
        status={requirementsFile ? 'selected' : sourceZipState.requirementsInZip ? 'selected' : 'optional'}
        detail={requirementsFile?.name || (sourceZipState.requirementsInZip ? 'Inside zip' : 'Optional missing')}
      />
      <UploadSummaryItem label="Training data" status={trainingData ? 'selected' : 'missing'} detail={trainingData?.name || 'Missing'} />
      <UploadSummaryItem
        label="Entry point"
        status={entryStatus}
        detail={
          sourceZipState.inspecting
            ? 'Inspecting...'
            : sourceZipState.error
              ? 'Inspect failed'
              : sourceZipState.entryExists
                ? sourceZipState.resolvedEntryPoint
                : 'Missing'
        }
      />
    </div>
  );
}

function UploadSummaryItem({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'selected' | 'missing' | 'optional' | 'inspecting' | 'found' | 'error';
  detail: string;
}) {
  const styles = {
    selected: 'text-emerald-700',
    found: 'text-emerald-700',
    missing: 'text-red-700',
    optional: 'text-gray-500',
    inspecting: 'text-blue-700',
    error: 'text-red-700',
  };

  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 shadow-sm border border-gray-100">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-bold ${styles[status]}`} title={detail}>
        {detail}
      </p>
    </div>
  );
}

function SourceValidationRow({
  label,
  message,
  ok,
  pending = false,
  warning = false,
}: {
  label: string;
  message: string;
  ok: boolean;
  pending?: boolean;
  warning?: boolean;
}) {
  const tone = pending ? 'gray' : ok ? 'green' : warning ? 'amber' : 'red';
  const styles: Record<'gray' | 'green' | 'amber' | 'red', string> = {
    gray: 'border-gray-200 bg-gray-50 text-gray-600',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  };

  return (
    <div className={`rounded-lg border px-3 py-2 shadow-sm ${styles[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
        {!ok && !pending && <AlertTriangle className="h-4 w-4" />}
        {message}
      </p>
    </div>
  );
}

function TrainingJobsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((item) => (
        <div key={item} className="animate-pulse rounded-lg border border-gray-300 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 w-48 rounded bg-gray-200" />
            <div className="h-7 w-24 rounded-full bg-gray-200" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
          </div>
          <div className="mt-4 h-20 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}





function TrainingJobRow({
  job,
  onRefresh,
  refreshing,
  onDownload,
  downloading,
}: {
  job: TrainingJob;
  onRefresh: (id: number) => void;
  refreshing: boolean;
  onDownload: (id: number) => void;
  downloading: boolean;
}) {
  const isArchived = job.is_deleted;
  const backendLabel = job.training_backend || 'sagemaker';

  const elapsed = () => {
    if (job.completed_at && job.started_at) {
      return (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000;
    }
    if (job.started_at && ['pending', 'uploading', 'running'].includes(job.status)) {
      return (new Date().getTime() - new Date(job.started_at).getTime()) / 1000;
    }
    return job.runtime_seconds || null;
  };
  const durationStr = (() => {
    const s = elapsed();
    if (!s) return '-';
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  })();

  const getAccentBorder = () => {
    if (isArchived) return 'border-l-4 border-l-gray-400 opacity-70 grayscale-[0.5]';
    if (job.status === 'completed') return 'border-l-4 border-l-emerald-500';
    if (job.status === 'failed') return 'border-l-4 border-l-red-500';
    if (job.status === 'running') return 'border-l-4 border-l-blue-500';
    return 'border-l-4 border-l-gray-300';
  };

  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:shadow-md ${getAccentBorder()}`}>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <Link to={`/dashboard/model-training/${job.id}`} className="text-lg font-bold text-gray-900 hover:text-blue-600 hover:underline truncate">
            {job.name}
          </Link>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 border border-gray-200 shrink-0">
            {job.model_version}
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
             isArchived ? 'bg-gray-100 text-gray-600' :
             job.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
             job.status === 'failed' ? 'bg-red-50 text-red-700' :
             job.status === 'running' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' :
             'bg-gray-50 text-gray-700'
          }`}>
             {isArchived ? 'Archived' : job.status}
          </span>
        </div>
        
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
           <span className="flex items-center gap-1"><Cpu className="w-3 h-3"/> {backendLabel}</span>
           <span className="flex items-center gap-1"><HardDrive className="w-3 h-3"/> {job.vcpu} vCPU, {job.memory / 1024} GB</span>
           {job.accelerator_type !== 'none' && (
             <span className="flex items-center gap-1 text-purple-600"><Rocket className="w-3 h-3"/> {job.accelerator_type.toUpperCase()} x{job.accelerator_count}</span>
           )}
           <span className="flex items-center gap-1"><Clock3 className="w-3 h-3"/> {durationStr} / {job.max_runtime_seconds}s</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
         {!isArchived && (
           <Button
             variant="secondary"
             size="sm"
             icon={<RefreshCw className="h-4 w-4" />}
             loading={refreshing}
             onClick={() => onRefresh(job.id)}
           >
             Refresh
           </Button>
         )}
         {!isArchived && job.status === 'completed' && (
           <Button
             variant="secondary"
             size="sm"
             icon={<Download className="h-4 w-4" />}
             loading={downloading}
             onClick={() => onDownload(job.id)}
           >
             Download
           </Button>
         )}
         <Link to={`/dashboard/model-training/${job.id}`}>
           <Button
             variant="primary"
             size="sm"
             icon={<Eye className="h-4 w-4" />}
           >
             View details
           </Button>
         </Link>
      </div>
    </div>
  );
}

