import { useState, useRef, useEffect, useCallback } from 'react';
import { FileCode2, Cpu, Play, AlertTriangle, Database, ArrowLeft, ArrowRight, Zap, Clock} from 'lucide-react';
import { useNavigate, Link, useBlocker } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { trainingQueryKeys } from '@/features/training/queryKeys';
import { Button } from '@/shared/ui/Button';
import { TerminalLogViewer } from '@/shared/ui/TerminalLogViewer';
import { TextEditor } from '@/features/catalog/components/TextEditor';
import { SummaryCard } from '@/shared/ui/SummaryCard';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { LineSteps } from '@/shared/ui/LineSteps';
import { StepTitle } from '@/shared/ui/StepTitle';
import { createTrainingJob, getTrainingJobLogs } from '@/features/training/api/trainingApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import { SourceEditor } from '@/features/catalog/components/SourceEditor';
import { Slider } from '@/shared/ui/Slider';
import type { TrainingJobFormValues, TrainingAcceleratorType } from '@/features/training/types';

const runtimeProfiles = [
  { id: 'small', labelKey: 'small', helperKey: 'cheaper', vcpu: 1, memory: 2048 },
  { id: 'medium', labelKey: 'medium', helperKey: 'recommended', vcpu: 2, memory: 4096 },
  { id: 'large', labelKey: 'large', helperKey: 'moreMemory', vcpu: 4, memory: 8192 },
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
  labelKey: string;
  type: TrainingAcceleratorType;
  count: number;
  disabled?: boolean;
  helperKey: string;
}> = [
  { labelKey: 'none', type: 'none', count: 0, helperKey: 'cpuHelper' },
  { labelKey: 'gpuOne', type: 'gpu', count: 1, disabled: true, helperKey: 'gpuHelper' },
  { labelKey: 'gpuTwo', type: 'gpu', count: 2, disabled: true, helperKey: 'gpuHelper' },
  { labelKey: 'gpuFour', type: 'gpu', count: 4, disabled: true, helperKey: 'gpuHelper' },
  { labelKey: 'tpu', type: 'tpu', count: 1, disabled: true, helperKey: 'comingSoon' },
  { labelKey: 'trainium', type: 'trainium', count: 1, disabled: true, helperKey: 'comingSoon' },
];

export function SummaryItem({ label, value, error }: { label: string; value: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <span className={`text-sm ${error ? 'text-danger font-semibold flex items-center gap-1' : 'text-foreground font-medium'}`}>
        {error && <AlertTriangle className="w-4 h-4" />}
        {value}
      </span>
    </div>
  );
}

export default function CreateTrainingJobPage() {
  const { t } = useTranslation('training');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedModel } = useModelSelection();
  const wizardSteps = [
    { id: 1, label: t('createJob.steps.sources'), icon: FileCode2 },
    { id: 2, label: t('createJob.steps.compute'), icon: Cpu },
    { id: 3, label: t('createJob.steps.execution'), icon: Play },
  ];

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<TrainingJobFormValues>({
    name: '',
    model_version: '',
    entry_point: '',
    requirements_text: '',
    vcpu: 2,
    memory: 4096,
    max_runtime_seconds: 3600,
    accelerator_type: 'none',
    accelerator_count: 0,
    source_zip: null,
    training_data: null,
  });

  const [trainingJobId, setTrainingJobId] = useState<string | null>(null);
  const [trainingLogs, setTrainingLogs] = useState<string[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [sourceCodeDirty, setSourceCodeDirty] = useState(false);
  const [referenceDataDirty, setReferenceDataDirty] = useState(false);
  const [requirementsDirty, setRequirementsDirty] = useState(false);
  const [showStepConfirm, setShowStepConfirm] = useState(false);
  const [showRequirementsDirtyWarning, setShowRequirementsDirtyWarning] = useState(false);

  const hasUnsavedChanges = sourceCodeDirty || referenceDataDirty || requirementsDirty;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  );

  // Before unload for browser tab close/refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!selectedModel) {
      navigate('/dashboard/model-training');
    }
  }, [selectedModel, navigate]);

  const setField = <K extends keyof TrainingJobFormValues>(field: K, value: TrainingJobFormValues[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const setRequirementsText = useCallback((requirementsText: string) => {
    setForm(prev => (
      prev.requirements_text === requirementsText
        ? prev
        : { ...prev, requirements_text: requirementsText }
    ));
  }, []);

  /** Called by TextEditor after a successful Save (PATCH ModelProject) */
  const handleRequirementsSaved = useCallback(() => {
    setRequirementsDirty(false);
  }, []);

  const currentProfileId = runtimeProfiles.find(p => p.vcpu === form.vcpu && p.memory === form.memory)?.id || 'medium';

  const canContinue = () => {
    if (step === 1) return Boolean(form.entry_point);
    if (step === 2) return true;
    return Boolean(form.entry_point);
  };

  const handleNext = () => {
    if (canContinue() && step < wizardSteps.length) {
      if (step === 1 && hasUnsavedChanges) {
        setShowStepConfirm(true);
      } else {
        setStep(s => s + 1);
      }
    }
  };

  const handleBack = () => {
    setStep(s => Math.max(1, s - 1));
  };

  const submitTraining = async () => {
    if (!selectedModel) return;

    // Guard: warn if requirements editor has unsaved changes
    if (requirementsDirty) {
      setShowRequirementsDirtyWarning(true);
      return;
    }

    await _doSubmitTraining();
  };

  const _doSubmitTraining = async () => {
    if (!selectedModel) return;
    setSubmitting(true);
    try {
      const payload: TrainingJobFormValues = {
        ...form,
        name: selectedModel.name,
        model_version: `v${(parseInt((selectedModel.version ?? '0').replace('v', '')) || 0) + 1}`,
        registered_model_id: selectedModel.id,
        // Intentionally omit requirements_text here — backend will read from
        // ModelProject.requirements_text (the last saved value) as source of truth.
        requirements_text: undefined as unknown as string,
      };

      const response = await createTrainingJob(payload);
      setTrainingJobId(response.id);
      setIsTraining(true);
      toast.success(t('createJob.started'));
      startLogPolling(response.id);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('createJob.unableToStart'));
      toast.error(t('createJob.startFailed', { message }));
    } finally {
      setSubmitting(false);
    }
  };

  const pollIntervalRef = useRef<number | undefined>(undefined);

  const stopTraining = () => {
    if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
    setIsTraining(false);
    setTrainingLogs(prev => [...prev, t('createJob.cancelledTracking')]);
  };
  const startLogPolling = (jobId: string) => {
    if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
    
    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const logs = await getTrainingJobLogs(jobId);
        if (logs.text) {
          setTrainingLogs(logs.text.split('\n'));
        }
        if (logs.status === 'completed' || logs.status === 'failed' || logs.status === 'cancelled') {
          window.clearInterval(pollIntervalRef.current);
          setIsTraining(false);
          if (logs.status === 'completed') {
             queryClient.invalidateQueries({ queryKey: trainingQueryKeys.jobs() });
          }
        }
      } catch (e) {
        console.error('Failed to poll logs', e);
      }
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
    };
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div className="mb-2">
          <Link
            to={selectedModel ? `/dashboard/model-training/${selectedModel.id}` : '/dashboard/model-training'}
            className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            onClick={(e) => { if (isTraining) { e.preventDefault(); } }}
          >
            <ArrowLeft className="h-4 w-4" />
            {t('createJob.backToTraining')}
          </Link>
          <h1 className="text-xl font-bold text-foreground">
            {selectedModel ? t('createJob.titleFor', { name: selectedModel.name }) : t('createJob.title')}
          </h1>
        </div>
      </div>

      <LineSteps steps={wizardSteps} currentStep={step} onStepChange={setStep} />

      <div className="bg-surface border border-border rounded-lg p-6 shadow-sm min-h-125">
        {step === 1 && selectedModel && (
          <div className="flex flex-col gap-8 h-full">
            <StepTitle title={t('createJob.codeData')} subtitle={t('createJob.codeDataDescription')}/>
            
            <SourceEditor 
              modelId={selectedModel.id.toString()} 
              fileType="code_file"
              title={t('createJob.sourceCode')}
              icon={<FileCode2 className="w-4 h-4" />}
              accept=".zip,.py"
              editorType="code"
              currentEntryPoint={form.entry_point}
              onSetEntryPoint={(file) => setField('entry_point', file)}
              onDirtyChange={setSourceCodeDirty}
            />

            <SourceEditor
              modelId={selectedModel.id.toString()} 
              fileType="data_file"
              title={t('createJob.referenceData')}
              icon={<Database className="w-4 h-4" />}
              accept=".zip,.csv"
              editorType="csv"
              onDirtyChange={setReferenceDataDirty}
            />

            {selectedModel && (
              <TextEditor
                modelProject={selectedModel}
                onDirtyChange={setRequirementsDirty}
                onContentChange={setRequirementsText}
                onSaveSuccess={handleRequirementsSaved}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <StepTitle title={t('createJob.computeResources')} subtitle={t('createJob.computeDescription')}/>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t('createJob.maxRuntime')}</label>
              <Slider
                options={runtimeOptions}
                value={form.max_runtime_seconds}
                onChange={(val) => setField('max_runtime_seconds', val)}
                getColor={(index) => {
                  if (index >= 5) return 'bg-red-500';
                  if (index >= 3) return 'bg-yellow-500';
                  return 'bg-green-500';
                }}
              />
            </div>
            
            <div className="mt-6">
              <label className="block text-sm font-medium text-foreground mb-2">{t('createJob.cpu')}</label>
              <div className="grid grid-cols-3 gap-4">
              {runtimeProfiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setField('vcpu', p.vcpu);
                    setField('memory', p.memory);
                  }}
                  className={`flex flex-col items-start p-4 border rounded-lg transition-all ${
                    currentProfileId === p.id
                      ? 'border-primary bg-primary-subtle text-primary ring-1 ring-primary'
                      : 'border-border hover:border-primary bg-surface'
                  }`}
                >
                  <span className="font-semibold text-foreground">{t(`createJob.profiles.${p.labelKey}`)}</span>
                  <span className="text-sm text-muted-foreground mt-1">{t(`createJob.profiles.${p.helperKey}`)}</span>
                  <div className="mt-4 flex gap-2 text-xs font-medium text-muted-foreground bg-surface px-2 py-1 rounded border">
                    <Cpu className="w-3.5 h-3.5" />
                    {p.vcpu} vCPU / {p.memory} MB
                  </div>
                </button>
              ))}
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-foreground mb-2">{t('createJob.acceleratorLabel')}</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {acceleratorOptions.map((opt) => {
                  const isSelected = form.accelerator_type === opt.type && form.accelerator_count === opt.count;
                  return (
                    <button
                      key={opt.labelKey}
                      disabled={opt.disabled}
                      onClick={() => {
                        setField('accelerator_type', opt.type);
                        setField('accelerator_count', opt.count);
                      }}
                      className={`flex flex-col items-start p-3 border rounded-lg transition-colors text-left ${
                        opt.disabled
                          ? 'opacity-50 cursor-not-allowed bg-muted border-border'
                          : isSelected
                          ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                          : 'border-border hover:border-primary bg-surface'
                      }`}
                    >
                      <span className={`font-semibold text-sm ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                        {t(`createJob.accelerator.${opt.labelKey}`)}
                      </span>
                      <span className="text-xs text-muted-foreground mt-0.5">{t(`createJob.accelerator.${opt.helperKey}`)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-6 h-full">
            <StepTitle title={t('createJob.summary')} subtitle={t('createJob.summaryDescription')}/>
            <div className="grid grid-cols-4 gap-4">
              <SummaryCard 
                label={t('createJob.mainFile')}
                value={form.entry_point || t('createJob.notSet')}
                icon={<FileCode2 className="w-4 h-4" />}
                tone={form.entry_point ? 'default' : 'error'}
              />
              <SummaryCard 
                label={t('createJob.compute')}
                value={`${form.vcpu} vCPU / ${form.memory} MB`} 
                icon={<Cpu className="w-4 h-4" />}
                tone="default"
              />
              <SummaryCard 
                label={t('createJob.acceleratorSummary')}
                value={form.accelerator_type === 'none' ? t('createJob.none') : `${form.accelerator_type.toUpperCase()} x${form.accelerator_count}`}
                icon={<Zap className="w-4 h-4" />}
                tone="default"
              />
              <SummaryCard 
                label={t('createJob.maxRuntime')}
                value={t('createJob.minutes', { count: form.max_runtime_seconds / 60 })}
                icon={<Clock className="w-4 h-4" />}
                tone="default"
              />
            </div>
            <div className="mt-4 flex-1">
              <TerminalLogViewer 
                title={t('createJob.logTitle')}
                placeholder={t('createJob.logPlaceholder')}
                logsOverride={trainingLogs}
                isRunningOverride={isTraining}
                startLabel={t('createJob.run')}
                stopLabel={t('createJob.stop')}
                restartLabel={t('createJob.rerun')}
                onRebuild={submitTraining}
                onCancel={stopTraining}
                buildDisabled={submitting || !form.entry_point}
              />
            </div>
          </div>
        )}
      </div>

      {!trainingJobId && (
        <div className="mt-8 grid gap-3 pt-5 border-t border-border sm:grid-cols-2">
          <Button
            variant="secondary"
            size="md"
            icon={<ArrowLeft className="h-4 w-4" />}
            disabled={step === 1}
            onClick={handleBack}
          >
            {t('createJob.back')}
          </Button>
          {step === wizardSteps.length ? (
            <Button
              size="md"
              icon={<Play className="h-4 w-4" />}
              disabled={!canContinue() || submitting}
              loading={submitting}
              onClick={submitTraining}
            >
              {t('createJob.run')}
            </Button>
          ) : (
            <Button
              size="md"
              disabled={!canContinue()}
              onClick={handleNext}
            >
              {t('createJob.continue')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <ConfirmModal
        open={blocker.state === 'blocked'}
        title={t('createJob.unsavedTitle')}
        description={t('createJob.leaveDescription')}
        confirmText={t('createJob.leaveDiscard')}
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />

      <ConfirmModal
        open={showStepConfirm}
        title={t('createJob.unsavedTitle')}
        description={t('createJob.stepDescription')}
        confirmText={t('createJob.continueAnyway')}
        tone="danger"
        onConfirm={() => {
          setShowStepConfirm(false);
          setStep(s => s + 1);
        }}
        onCancel={() => setShowStepConfirm(false)}
      />

      <ConfirmModal
        open={showRequirementsDirtyWarning}
        title={t('createJob.requirementsTitle')}
        description={
          <span>
            {t('createJob.requirementsIntro')}
            <br /><br />
            {t('createJob.requirementsSavedVersion')}
            <br /><br />
            {t('createJob.requirementsSaveHint')}
          </span>
        }
        confirmText={t('createJob.proceedSaved')}
        cancelText={t('createJob.goBackSave')}
        tone="danger"
        onConfirm={() => {
          setShowRequirementsDirtyWarning(false);
          _doSubmitTraining();
        }}
        onCancel={() => setShowRequirementsDirtyWarning(false)}
      />
    </section>
  );
}
