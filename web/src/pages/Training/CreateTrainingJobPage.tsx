import { useState, useRef, useEffect, useCallback } from 'react';
import { FileCode2, Cpu, Play, AlertTriangle, Database, ArrowLeft, ArrowRight, Zap, Clock} from 'lucide-react';
import { useNavigate, Link, useBlocker } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { Button } from '../../components/ui/Button';
import { TerminalLogViewer } from '../../components/ui/TerminalLogViewer';
import { TextEditor } from '../../components/ui/TextEditor';
import { SummaryCard } from '../../components/ui/SummaryCard';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { LineSteps } from '../../components/ui/LineSteps';
import { StepTitle } from '../../components/ui/StepTitle';
import { createTrainingJob, getTrainingJobLogs } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { useModelSelection } from '../../hooks/useModelSelection';
import { SourceEditor } from '../../components/ui/SourceEditor';
import { Slider } from '../../components/ui/Slider';
import type { TrainingJobFormValues, TrainingAcceleratorType } from '../../types/models';

const wizardSteps = [
  { id: 1, label: 'Sources', icon: FileCode2 },
  { id: 2, label: 'Compute', icon: Cpu },
  { id: 3, label: 'Execution', icon: Play },
];

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
  { label: 'No accelerator', type: 'none', count: 0, helper: 'Kubeflow CPU job' },
  { label: 'GPU x1', type: 'gpu', count: 1, disabled: true, helper: 'Requires GPU Karpenter capacity' },
  { label: 'GPU x2', type: 'gpu', count: 2, disabled: true, helper: 'Requires GPU Karpenter capacity' },
  { label: 'GPU x4', type: 'gpu', count: 4, disabled: true, helper: 'Requires GPU Karpenter capacity' },
  { label: 'TPU', type: 'tpu', count: 1, disabled: true, helper: 'Coming soon' },
  { label: 'Trainium', type: 'trainium', count: 1, disabled: true, helper: 'Coming soon' },
];

export function SummaryItem({ label, value, error }: { label: string; value: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-500 text-sm font-medium">{label}</span>
      <span className={`text-sm ${error ? 'text-red-600 font-semibold flex items-center gap-1' : 'text-gray-900 font-medium'}`}>
        {error && <AlertTriangle className="w-4 h-4" />}
        {value}
      </span>
    </div>
  );
}

export default function CreateTrainingJobPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedModel } = useModelSelection();

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
      toast.success('Training job started!');
      startLogPolling(response.id);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Unable to start training job.');
      toast.error(`Failed to start training: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const pollIntervalRef = useRef<number | undefined>(undefined);

  const stopTraining = () => {
    if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
    setIsTraining(false);
    setTrainingLogs(prev => [...prev, '[SYSTEM] Training tracking cancelled by user.']);
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
             queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs });
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
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="mb-2">
          <Link
            to={selectedModel ? `/dashboard/model-training/${selectedModel.id}` : '/dashboard/model-training'}
            className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-black"
            onClick={(e) => { if (isTraining) { e.preventDefault(); } }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Model Training
          </Link>
          <h1 className="text-xl font-bold text-gray-900">
            New Training Job{selectedModel ? ` for ${selectedModel.name}` : ''}
          </h1>
        </div>
      </div>

      <LineSteps steps={wizardSteps} currentStep={step} onStepChange={setStep} />

      <div className="bg-white border border-gray-300 rounded-lg p-6 shadow-sm min-h-125">
        {step === 1 && selectedModel && (
          <div className="flex flex-col gap-8 h-full">
            <StepTitle title="Code & Data" subtitle="Review and edit the model's source code and reference data before starting the training job."/>
            
            <SourceEditor 
              modelId={selectedModel.id.toString()} 
              fileType="code_file"
              title="Source Code"
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
              title="Reference Data"
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
            <StepTitle title="Compute Resources" subtitle="Select the hardware configuration for the training job."/>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Runtime</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">Compute (CPU)</label>
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
                      ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                      : 'border-gray-200 hover:border-blue-300 bg-white'
                  }`}
                >
                  <span className="font-semibold text-gray-900">{p.label}</span>
                  <span className="text-sm text-gray-500 mt-1">{p.helper}</span>
                  <div className="mt-4 flex gap-2 text-xs font-medium text-gray-600 bg-white px-2 py-1 rounded border">
                    <Cpu className="w-3.5 h-3.5" />
                    {p.vcpu} vCPU / {p.memory} MB
                  </div>
                </button>
              ))}
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Accelerator (GPU)</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {acceleratorOptions.map((opt) => {
                  const isSelected = form.accelerator_type === opt.type && form.accelerator_count === opt.count;
                  return (
                    <button
                      key={opt.label}
                      disabled={opt.disabled}
                      onClick={() => {
                        setField('accelerator_type', opt.type);
                        setField('accelerator_count', opt.count);
                      }}
                      className={`flex flex-col items-start p-3 border rounded-lg transition-colors text-left ${
                        opt.disabled
                          ? 'opacity-50 cursor-not-allowed bg-gray-50 border-gray-200'
                          : isSelected
                          ? 'border-purple-600 bg-purple-50 ring-1 ring-purple-600'
                          : 'border-gray-200 hover:border-purple-300 bg-white'
                      }`}
                    >
                      <span className={`font-semibold text-sm ${isSelected ? 'text-purple-900' : 'text-gray-900'}`}>
                        {opt.label}
                      </span>
                      <span className="text-xs text-gray-500 mt-0.5">{opt.helper}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-6 h-full">
            <StepTitle title="Summary & Execution" subtitle="Review your configurations and start the training job."/>
            <div className="grid grid-cols-4 gap-4">
              <SummaryCard 
                label="Main File" 
                value={form.entry_point || 'Not Set'} 
                icon={<FileCode2 className="w-4 h-4" />}
                tone={form.entry_point ? 'default' : 'error'}
              />
              <SummaryCard 
                label="Compute" 
                value={`${form.vcpu} vCPU / ${form.memory} MB`} 
                icon={<Cpu className="w-4 h-4" />}
                tone="default"
              />
              <SummaryCard 
                label="Accelerator" 
                value={form.accelerator_type === 'none' ? 'None' : `${form.accelerator_type.toUpperCase()} x${form.accelerator_count}`}
                icon={<Zap className="w-4 h-4" />}
                tone="default"
              />
              <SummaryCard 
                label="Max Runtime" 
                value={`${form.max_runtime_seconds / 60} minutes`} 
                icon={<Clock className="w-4 h-4" />}
                tone="default"
              />
            </div>
            <div className="mt-4 flex-1">
              <TerminalLogViewer 
                title="Training Logs (Kubeflow)"
                placeholder="Click 'Run Training' to submit a Kubeflow training job and execute your code."
                logsOverride={trainingLogs}
                isRunningOverride={isTraining}
                startLabel="Run Training"
                stopLabel="Stop"
                restartLabel="Re-Run Training"
                onRebuild={submitTraining}
                onCancel={stopTraining}
                buildDisabled={submitting || !form.entry_point}
              />
            </div>
          </div>
        )}
      </div>

      {!trainingJobId && (
        <div className="mt-8 grid gap-3 pt-5 border-t border-gray-200 sm:grid-cols-2">
          <Button
            variant="secondary"
            size="md"
            icon={<ArrowLeft className="h-4 w-4" />}
            disabled={step === 1}
            onClick={handleBack}
          >
            Back
          </Button>
          {step === wizardSteps.length ? (
            <Button
              size="md"
              icon={<Play className="h-4 w-4" />}
              disabled={!canContinue() || submitting}
              loading={submitting}
              onClick={submitTraining}
            >
              Run Training
            </Button>
          ) : (
            <Button
              size="md"
              disabled={!canContinue()}
              onClick={handleNext}
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <ConfirmModal
        open={blocker.state === 'blocked'}
        title="Unsaved Changes"
        description="You have unsaved changes in your source code, reference data, or requirements. If you leave this page, your changes will be lost."
        confirmText="Leave and Discard"
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />

      <ConfirmModal
        open={showStepConfirm}
        title="Unsaved Changes"
        description="You have unsaved changes in your files. Are you sure you want to continue without saving? Your changes will not be included in the training job."
        confirmText="Continue Anyway"
        tone="danger"
        onConfirm={() => {
          setShowStepConfirm(false);
          setStep(s => s + 1);
        }}
        onCancel={() => setShowStepConfirm(false)}
      />

      <ConfirmModal
        open={showRequirementsDirtyWarning}
        title="Requirements Not Saved"
        description={
          <span>
            You have edited <strong>requirements.txt</strong> but have not saved it yet.
            <br /><br />
            The training job will use the <strong>last saved version</strong> from the server, not your current unsaved edits.
            <br /><br />
            Go back and click <strong>Save</strong> in the requirements editor to include your latest changes.
          </span>
        }
        confirmText="Proceed with Saved Version"
        cancelText="Go Back and Save"
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
