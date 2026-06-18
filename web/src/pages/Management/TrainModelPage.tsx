import {
  Archive,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Clock3,
  Cpu,
  Download,
  FileArchive,
  FileCode2,
  FileText,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Rocket,
  ScrollText,
  UploadCloud,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  createTrainingJob,
  deleteTrainingJob,
  getTrainingJobDownloadUrl,
  getTrainingJobLogs,
  getTrainingUsage,
  listTrainingJobs,
  refreshTrainingJobStatus,
  restoreTrainingJob,
} from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import { downloadSampleTrainingTemplate } from '../../lib/trainingTemplate';
import { inspectZipFile, readZipEntryText, rebuildZipWithEditedEntry } from '../../lib/trainingZip';
import type { TrainingJob, TrainingJobFormValues, TrainingJobStatus } from '../../types/modelApi';
import { SummaryItem } from './UploadModelFormPage';

const initialForm: TrainingJobFormValues = {
  name: '',
  model_version: '',
  entry_point: 'train.py',
  vcpu: 2,
  memory: 4096,
  max_runtime_seconds: 3600,
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

const jobLabel = (job: Pick<TrainingJob, 'name' | 'model_version'>) => `${job.name} ${job.model_version}`.trim();

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
  const [logsByJobId, setLogsByJobId] = useState<Record<number, string>>({});
  const [expandedLogJobIds, setExpandedLogJobIds] = useState<Record<number, boolean>>({});
  const [sourceZipState, setSourceZipState] = useState<SourceZipState>(emptySourceZipState);
  const [editedEntryText, setEditedEntryText] = useState('');
  const [entryEdited, setEntryEdited] = useState(false);
  const [preparingSubmit, setPreparingSubmit] = useState(false);
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

    const syncTrainingJobs = async () => {
      await Promise.all(
        syncableJobs.map(async (job) => {
          try {
            const shouldRefreshLogs = job.status === 'running' && expandedLogJobIds[job.id];
            const [updatedJob, logsResponse] = await Promise.all([
              refreshTrainingJobStatus(job.id),
              shouldRefreshLogs ? getTrainingJobLogs(job.id).catch(() => null) : Promise.resolve(null),
            ]);

            if (cancelled) return;

            queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
              training_jobs: upsertTrainingJob(current?.training_jobs ?? [], updatedJob),
            }));

            if (logsResponse?.text || logsResponse?.logs) {
              setLogsByJobId((current) => ({ ...current, [job.id]: logsResponse.text || logsResponse.logs }));
            }

            if (updatedJob.status !== job.status) {
              void invalidateUsage();
              if (statusNotificationRef.current[updatedJob.id] !== updatedJob.status) {
                statusNotificationRef.current[updatedJob.id] = updatedJob.status;
                transitionToast(job, updatedJob);
              }
            }
          } catch {
            // Auto-sync stays quiet on transient backend/AWS polling errors.
          }
        }),
      );
    };

    void syncTrainingJobs();
    const intervalId = window.setInterval(() => {
      void syncTrainingJobs();
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTrainingJobs, expandedLogJobIds, invalidateUsage, queryClient]);

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

  const logsMutation = useMutation({
    mutationFn: (job: TrainingJob) => getTrainingJobLogs(job.id),
    onSuccess: ({ logs, text }, job) => {
      setLogsByJobId((current) => ({ ...current, [job.id]: text || logs }));
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to load training logs.')}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (job: TrainingJob) => deleteTrainingJob(job.id),
    onSuccess: (updatedJob) => {
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], updatedJob),
      }));
      void invalidateUsage();
      toast.success(`${jobLabel(updatedJob)} archived. You can restore it from Archived jobs.`);
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to archive training job.')}`);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (job: TrainingJob) => restoreTrainingJob(job.id),
    onSuccess: (updatedJob) => {
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], updatedJob),
      }));
      void invalidateUsage();
      toast.success(`${jobLabel(updatedJob)} restored.`);
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to restore training job.')}`);
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

  const toggleLogs = (job: TrainingJob) => {
    setExpandedLogJobIds((current) => ({ ...current, [job.id]: !current[job.id] }));
    if (!expandedLogJobIds[job.id]) {
      logsMutation.mutate(job);
    }
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
    (!usage || form.max_runtime_seconds <= usage.remaining_seconds);

  return (
    <section className="flex w-full flex-1 flex-col space-y-5">
      <div className="flex flex-col gap-2 border-b border-gray-300 pb-3">
        <h1 className="text-lg font-bold text-gray-900">Model Training</h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-500">
          Upload training code and data, run a backend training job, inspect logs, and download the private model artifact from S3.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <UsageCard
          icon={<Clock3 className="h-4 w-4" />}
          label="Used this month"
          value={isUsageLoading ? 'Loading...' : formatDuration(usage?.monthly_runtime_seconds)}
        />
        <UsageCard
          icon={<Clock3 className="h-4 w-4" />}
          label="Monthly quota"
          value={formatDuration(usage?.monthly_quota_seconds || 43200)}
        />
        <UsageCard
          icon={<Clock3 className="h-4 w-4" />}
          label="Remaining"
          value={isUsageLoading ? 'Loading...' : formatDuration(usage?.remaining_seconds)}
          tone={usage && usage.remaining_seconds < form.max_runtime_seconds ? 'danger' : 'default'}
        />
        <UsageCard
          icon={<Rocket className="h-4 w-4" />}
          label="Running jobs"
          value={String(usage?.running_jobs_count ?? 0)}
        />
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

        <UploadSummary
          sourceZip={form.source_zip}
          requirementsFile={form.requirements_file}
          trainingData={form.training_data}
          sourceZipState={sourceZipState}
        />

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
                  <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {sourceZipState.error}
                  </div>
                )}
                {sourceZipState.warning && (
                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    {sourceZipState.warning}
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
                  className={`rounded-lg border p-3 text-left transition ${
                    selected ? 'border-black bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-400'
                  }`}
                  onClick={() => selectRuntimeProfile(profile.vcpu, profile.memory)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-gray-900">{profile.label}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-500">
                      {profile.helper}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-gray-500">
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3.5 w-3.5" />
                      {profile.vcpu} vCPU
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3.5 w-3.5" />
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
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-gray-300 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Training jobs</h2>
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
            <div className="grid gap-4 xl:grid-cols-2">
              {trainingJobs.map((job) => (
                <TrainingJobCard
                  key={job.id}
                  job={job}
                  refreshing={refreshMutation.isPending}
                  downloading={downloadMutation.isPending}
                  loadingLogs={logsMutation.isPending}
                  archiving={deleteMutation.isPending}
                  restoring={restoreMutation.isPending}
                  logText={logsByJobId[job.id] || job.training_logs || job.error_message}
                  logsExpanded={Boolean(expandedLogJobIds[job.id])}
                  onRefresh={() => refreshMutation.mutate(job)}
                  onDownload={() => downloadMutation.mutate(job)}
                  onRefreshLogs={() => logsMutation.mutate(job)}
                  onToggleLogs={() => toggleLogs(job)}
                  onArchive={() => deleteMutation.mutate(job)}
                  onRestore={() => restoreMutation.mutate(job)}
                  onCopyUri={copyUri}
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

function UsageCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-4 ${
        tone === 'danger' ? 'border-red-100 text-red-700' : 'border-gray-300 text-gray-900'
      }`}
    >
      <p className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-400">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-lg font-bold">{value}</p>
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
  const status = file ? (valid ? 'Selected' : 'Invalid') : required ? 'Missing' : 'Optional';
  const statusClass = file
    ? valid
      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
      : 'border-red-100 bg-red-50 text-red-700'
    : required
      ? 'border-amber-100 bg-amber-50 text-amber-700'
      : 'border-gray-200 bg-gray-50 text-gray-500';

  return (
    <div className={`rounded-lg border p-4 ${file ? 'border-gray-400 bg-white' : 'border-dashed border-gray-300 bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{label}</p>
          <p className="mt-1 text-xs text-gray-500">{required ? `Required ${expected}` : `Optional ${expected}`}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${statusClass}`}>{status}</span>
      </div>

      {file ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="truncate text-sm font-semibold text-gray-900" title={file.name}>
            {file.name}
          </p>
          <p className="mt-1 text-xs text-gray-500">{formatFileSize(file)}</p>
        </div>
      ) : (
        <div className="mt-4 flex min-h-16 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-3 text-center text-sm text-gray-500">
          No file selected
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {file && (
          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
        <label
          htmlFor={inputId}
          className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-gray-200"
        >
          <UploadCloud className="h-4 w-4" />
          {file ? 'Change file' : 'Select file'}
        </label>
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
    <div className="mt-4 grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm md:grid-cols-4">
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
    <div className="min-w-0 rounded-md bg-white px-3 py-2">
      <p className="text-xs font-semibold uppercase text-gray-400">{label}</p>
      <p className={`mt-1 truncate text-sm font-bold ${styles[status]}`} title={detail}>
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
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    red: 'border-red-100 bg-red-50 text-red-700',
  };

  return (
    <div className={`rounded-lg border px-3 py-2 ${styles[tone]}`}>
      <p className="text-xs font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
        {!ok && !pending && <AlertTriangle className="h-4 w-4" />}
        {message}
      </p>
    </div>
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
  archiving,
  restoring,
  logText,
  logsExpanded,
  onRefresh,
  onDownload,
  onRefreshLogs,
  onToggleLogs,
  onArchive,
  onRestore,
  onCopyUri,
}: {
  job: TrainingJob;
  refreshing: boolean;
  downloading: boolean;
  loadingLogs: boolean;
  archiving: boolean;
  restoring: boolean;
  logText?: string;
  logsExpanded: boolean;
  onRefresh: () => void;
  onDownload: () => void;
  onRefreshLogs: () => void;
  onToggleLogs: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onCopyUri: (value: string) => void;
}) {
  const runtimeSummary = `${job.vcpu} vCPU / ${job.memory / 1024} GB`;
  const externalJobId = job.external_job_id || job.sagemaker_job_name || '';

  return (
    <article className="rounded-lg border border-gray-300 bg-white p-4">
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-bold text-gray-900">{job.name}</p>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
              {job.model_version}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase text-gray-400">
            {backendLabel(job.training_backend)} · {runtimeSummary}
          </p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${statusStyles[job.status]}`}>
          {job.is_deleted ? 'Archived' : statusLabels[job.status]}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <InlineFact icon={<Cpu className="h-3.5 w-3.5" />} label="Runtime" value={runtimeSummary} />
        <InlineFact icon={<Clock3 className="h-3.5 w-3.5" />} label="Max" value={formatDuration(job.max_runtime_seconds)} />
        <InlineFact icon={<Clock3 className="h-3.5 w-3.5" />} label="Elapsed" value={formatDuration(elapsedForJob(job))} />
        <InlineFact label="Entry" value={job.entry_point || '-'} />
        <InlineFact label="Started" value={job.started_at ? new Date(job.started_at).toLocaleString() : '-'} />
        <InlineFact label="Completed" value={job.completed_at ? new Date(job.completed_at).toLocaleString() : '-'} />
        <InlineFact label="Updated" value={job.updated_at ? new Date(job.updated_at).toLocaleString() : '-'} />
        {job.is_deleted && <InlineFact label="Archived" value={job.deleted_at ? new Date(job.deleted_at).toLocaleString() : '-'} />}
      </div>

      <div className="mt-3 space-y-2">
        <UriLine
          icon={<Rocket className="h-4 w-4" />}
          label="External job ID"
          value={externalJobId}
          onCopy={onCopyUri}
        />
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

      {job.stop_reason && !job.error_message && (
        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
          {job.stop_reason}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {job.is_deleted ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-4 w-4" />}
            loading={restoring}
            onClick={onRestore}
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<Archive className="h-4 w-4" />}
            loading={archiving}
            onClick={onArchive}
          >
            Archive
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={logsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          onClick={onToggleLogs}
        >
          {logsExpanded ? 'Hide logs' : 'Show logs'}
        </Button>
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

      {logsExpanded && (
        <LogTerminal
          text={logText || 'Logs are not available yet. They usually appear after the Batch container starts.'}
          loading={loadingLogs}
          onRefresh={onRefreshLogs}
        />
      )}
    </article>
  );
}

function InlineFact({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-gray-50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase text-gray-400">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-gray-700" title={value}>
        {value}
      </p>
    </div>
  );
}

function LogTerminal({
  text,
  loading,
  onRefresh,
}: {
  text: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [text]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 24;
  };

  return (
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
          loading={loading}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>
      <pre
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-72 min-h-40 overflow-y-auto whitespace-pre-wrap p-4 text-xs leading-5 text-gray-100"
      >
        {text}
      </pre>
    </div>
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
