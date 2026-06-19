import { FileArchive, FileCode2, FlaskConical, Rocket, UploadCloud, Terminal, RefreshCw, ArrowLeft, ArrowRight, Play } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import type { ModelBuildFormValues, ModelFlavor } from '../../types/modelApi';
import { AccessModePicker, FileDropzone, StepTitle, SummaryItem, TextArea, } from './UploadModelFormPage';
import { buildModelAPI, getBuildLogs, getModelAPI, cancelBuildAPI, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../lib/toast';

const wizardSteps = [
  { id: 1, label: 'Metadata', icon: FileCode2 },
  { id: 2, label: 'Artifact', icon: UploadCloud },
  { id: 3, label: 'Flavor', icon: FlaskConical },
  { id: 4, label: 'Requirements', icon: FileArchive },
  { id: 5, label: 'Deploy', icon: Rocket },
];

export default function BuildPackagePage({
  step,
  setStep,
  form,
  setField,
  readRequirementsFile,
  preview,
  submit,
  loading,
  canContinue,
  onBuildSuccess,
}: {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
  readRequirementsFile: (file: File | null) => void;
  preview: string[];
  submit: () => void;
  loading: boolean;
  canContinue: () => boolean;
  onBuildSuccess: (modelId: number, previewTree: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="hidden sm:block rounded-lg border border-gray-300 bg-white px-8 pb-10 pt-6">
        <div className="relative flex items-center justify-between">
          {/* Background line */}
          <div className="absolute left-0 top-5 h-0.5 w-full bg-gray-200" />
          {/* Active line */}
          <div
            className="absolute left-0 top-5 h-0.5 bg-black transition-all duration-300"
            style={{ width: `${((step - 1) / (wizardSteps.length - 1)) * 100}%` }}
          />

          {wizardSteps.map((item) => {
            const Icon = item.icon;
            const active = step === item.id;
            const done = step > item.id;
            const disabled = item.id > step;

            return (
              <div key={item.id} className="relative z-10 flex flex-col items-center bg-white px-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setStep(item.id)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    active
                      ? 'border-black bg-black text-white'
                      : done
                        ? 'border-black bg-white text-black hover:bg-gray-100'
                        : 'border-gray-200 bg-white text-gray-300'
                  } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
                <span
                  className={`absolute -bottom-7 whitespace-nowrap text-xs font-bold ${
                    active ? 'text-black' : done ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fallback stepper cho mobile */}
      <div className="sm:hidden rounded-lg border border-gray-300 bg-white p-4 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">Step {step} of {wizardSteps.length}</span>
        <span className="text-sm font-semibold text-gray-500">{wizardSteps[step - 1]?.label}</span>
      </div>

      <div className="rounded-lg border border-gray-300 bg-white p-6">
        {step === 1 && (
          <MetadataStep form={form} setField={setField} />
        )}
        {step === 2 && (
          <ArtifactStep form={form} setField={setField} />
        )}
        {step === 3 && (
          <FlavorStep form={form} setField={setField} />
        )}
        {step === 4 && (
          <RequirementsStep form={form} setField={setField} readRequirementsFile={readRequirementsFile} />
        )}
        {step === 5 && (
          <DeployStep form={form} preview={preview} onBuildSuccess={onBuildSuccess} canContinue={canContinue()} />
        )}

        <div className="mt-8 grid gap-3 pt-5 border-t border-gray-200 sm:grid-cols-2">
          <Button
            variant="secondary"
            size="md"
            icon={<ArrowLeft className="h-4 w-4" />}
            disabled={step === 1 || loading}
            onClick={() => setStep((current) => Math.max(1, current - 1))}
          >
            Back
          </Button>
          {step < 5 ? (
            <Button
              size="md"
              disabled={!canContinue() || loading}
              onClick={() => setStep((current) => Math.min(5, current + 1))}
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="md"
              icon={<Rocket className="h-4 w-4" />}
              disabled={!canContinue() || !form.name.trim()}
              loading={loading}
              onClick={submit}
            >
              Deploy model
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetadataStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Model metadata" description="Describe the model and decide whether the prediction API is public or private." />
      <Input
        label="Model Name"
        value={form.name}
        onChange={(event) => setField('name', event.target.value)}
        placeholder="e.g. CICIDS Classifier"
      />
      <TextArea
        id="build-description"
        label="Description"
        value={form.description}
        onChange={(value) => setField('description', value)}
        placeholder="What does this model classify or detect?"
      />
      <TextArea
        id="build-model-info"
        label="Model Information"
        value={form.model_info}
        onChange={(value) => setField('model_info', value)}
        placeholder="Framework, labels, expected inputs, F1 score, or other notes."
      />
      <AccessModePicker value={form.access_mode} onChange={(value) => setField('access_mode', value)} />
    </div>
  );
}

function ArtifactStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Upload raw artifact" description="Choose a model file. Phase 1 supports .pkl, .joblib, and .xgb artifacts." />
      <FileDropzone
        accept=".pkl,.joblib,.xgb"
        title={form.source_artifact ? form.source_artifact.name : 'Choose raw model artifact'}
        subtitle=".pkl, .joblib, or .xgb"
        onChange={(file) => setField('source_artifact', file)}
      />

      <StepTitle title="Upload Label Mapping (Optional)" description="Choose a dictionary file to map numeric outputs to string labels." />
      <FileDropzone
        accept=".pkl,.json"
        title={form.label_mapping_file ? form.label_mapping_file.name : 'Choose label mapping file'}
        subtitle=".pkl or .json (Optional)"
        onChange={(file) => setField('label_mapping_file', file)}
      />
    </div>
  );
}

function FlavorStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  const options: Array<{ value: ModelFlavor; title: string; description: string }> = [
    { value: 'sklearn', title: 'Scikit-learn', description: 'Use for sklearn estimators saved as .pkl or .joblib.' },
    { value: 'xgboost', title: 'XGBoost', description: 'Use for XGBoost Booster/XGBModel saved as .xgb, .pkl, or .joblib.' },
  ];

  return (
    <div className="space-y-5">
      <StepTitle title="Choose framework flavor" description="The packager uses this flavor to call the correct MLflow save_model function." />
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setField('flavor', option.value)}
            className={`rounded-2xl border p-5 text-left transition-colors ${
              form.flavor === option.value
                ? 'border-black bg-black text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-black'
            }`}
          >
            <span className="text-sm font-bold">{option.title}</span>
            <p className={`mt-2 text-sm leading-6 ${form.flavor === option.value ? 'text-gray-300' : 'text-gray-500'}`}>
              {option.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function RequirementsStep({
  form,
  setField,
  readRequirementsFile,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
  readRequirementsFile: (file: File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Runtime requirements" description="Paste requirements or upload requirements.txt. These lines are written into the MLflow package." />
      <FileDropzone
        accept=".txt,text/plain"
        title={form.requirements_file ? form.requirements_file.name : 'Upload requirements.txt'}
        subtitle="Optional"
        onChange={readRequirementsFile}
      />
      <TextArea
        id="requirements-text"
        label="requirements.txt"
        value={form.requirements_text}
        onChange={(value) => setField('requirements_text', value)}
        placeholder={'scikit-learn==1.7.2\npandas==2.2.1\nnumpy==1.26.4'}
        minHeight="min-h-48"
      />
    </div>
  );
}

function DeployStep({
  form,
  onBuildSuccess,
}: {
  form: ModelBuildFormValues;
  preview: string[];
  onBuildSuccess: (modelId: number, previewTree: string[]) => void;
  canContinue: boolean;
}) {
  const [building, setBuilding] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<string>('not_started');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const modelIdRef = useRef<number | null>(null);

  const startBuild = async () => {
    try {
      setBuilding(true);
      setLogs(['[SYSTEM] Initiating build process...']);
      setErrorMsg('');
      setBuildStatus('building');
      offsetRef.current = 0;
      
      const model = await buildModelAPI(form);
      modelIdRef.current = model.id;
    } catch (e) {
      setBuilding(false);
      setBuildStatus('error');
      const msg = getApiErrorMessage(e, "Failed to start build process.");
      setErrorMsg(msg);
      toast.error(msg);
    }
  };

  const rebuild = async () => {
    if (modelIdRef.current) {
      try {
        await cancelBuildAPI(modelIdRef.current);
      } catch (e) {
        const msg = getApiErrorMessage(e, "Failed to cancel build process.");
        setErrorMsg(msg);
        toast.error(msg);
      }
    }
    startBuild();
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    const fetchLogs = async () => {
      if (!modelIdRef.current || buildStatus !== 'building') return;
      try {
        const data = await getBuildLogs(modelIdRef.current, offsetRef.current);
        if (data.logs.length > 0) {
          setLogs(prev => {
            const newLogs = [...prev];
            data.logs.forEach(log => {
              if (log === 'BUILD_EOF_SUCCESS' || log === 'BUILD_EOF_ERROR') return;
              newLogs.push(log);
            });
            return newLogs;
          });
          offsetRef.current = data.next_offset;
        }
        
        if (data.build_status === 'ready' || data.build_status === 'error') {
          setBuildStatus(data.build_status);
          setBuilding(false);
          if (data.build_status === 'ready') {
             toast.success('Build completed successfully!');
             const finalModel = await getModelAPI(modelIdRef.current);
             onBuildSuccess(finalModel.id, finalModel.package_preview_tree || []);
          } else {
             setErrorMsg(data.build_error || 'Build failed.');
             toast.error('Build failed.');
          }
        } else if (data.logs.includes('BUILD_EOF_ERROR')) {
          setBuildStatus('error');
          setBuilding(false);
          setErrorMsg('Build process exited with an error.');
        } else if (data.logs.includes('BUILD_EOF_SUCCESS')) {
          setBuildStatus('ready');
          setBuilding(false);
          toast.success('Build completed successfully!');
          const finalModel = await getModelAPI(modelIdRef.current);
          onBuildSuccess(finalModel.id, finalModel.package_preview_tree || []);
        }
      } catch {
        // silently ignore network errors during polling
      }
    };

    if (building) {
      interval = setInterval(fetchLogs, 1000);
    }
    
    return () => clearInterval(interval);
  }, [building, buildStatus, onBuildSuccess]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="space-y-5">
      <StepTitle title="Preview & Deploy" description="Review your model configuration, build the MLflow package, and then deploy it as a REST API." />
      
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryItem label="Model" value={form.name || 'Untitled model'} />
        <SummaryItem label="Access" value={`${form.access_mode} API`} />
        <SummaryItem label="Flavor" value={form.flavor} />
        <SummaryItem label="Artifact" value={form.source_artifact?.name || 'Missing artifact'} />
      </div>

      {/* Terminal UI */}
      <div className="overflow-hidden rounded-xl bg-gray-900 shadow-lg border border-gray-800">
        <div className="flex items-center px-4 py-2 bg-gray-800/80 border-b border-gray-700">
          <Terminal className="h-4 w-4 text-gray-400 mr-2" />
          <span className="text-xs font-mono text-gray-400">Build Console</span>
          {building && <span className="ml-auto flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>}
          <div className="ml-auto flex items-center">
            {buildStatus === 'not_started' ? (
              <button
                type="button"
                onClick={startBuild}
                disabled={!form.source_artifact}
                className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1 text-xs font-medium text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Start build process"
              >
                <Play className="h-3 w-3" />
                Build
              </button>
            ) : (
              <button
                type="button"
                onClick={rebuild}
                className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1 text-xs font-medium text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
                title="Force destroy current process and Rebuild"
              >
                <RefreshCw className={`h-3 w-3 ${building ? 'animate-spin' : ''}`} />
                Rebuild
              </button>
            )}
          </div>
        </div>
        <div 
          ref={terminalRef}
          className="p-4 h-64 overflow-y-auto font-mono text-sm text-green-400 whitespace-pre-wrap break-all custom-scrollbar"
          style={{ scrollBehavior: 'smooth' }}
        >
          {logs.length === 0 && !building && buildStatus === 'not_started' && (
            <div className="text-gray-500 italic">Click "Build" to start the model packager...</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className="mb-1 leading-relaxed opacity-90">{log}</div>
          ))}
          {building && <div className="animate-pulse">_</div>}
          {errorMsg && <div className="text-red-400 mt-4">[ERROR] {errorMsg}</div>}
        </div>
      </div>

      {buildStatus === 'ready' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 flex items-center">
          <div className="font-semibold">Build Successful!</div>
          <div className="ml-auto">Click Deploy model below to continue.</div>
        </div>
      )}
    </div>
  );
}
