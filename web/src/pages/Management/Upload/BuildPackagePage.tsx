import { useState } from 'react';
import { FileCode2, UploadCloud, FlaskConical, FileArchive, Rocket, ArrowLeft, ArrowRight, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { ModelBuildFormValues, ModelFlavor } from '../../../types/modelApi';
import { SummaryItem } from './UploadModelFormPage';
import { StepTitle } from '../../../components/ui/StepTitle';
import { FileDropzone } from '../../../components/ui/FileDropzone';
import { TextArea } from '../../../components/ui/TextArea';
import { AccessModePicker } from '../../../components/ui/Picker';
import { toast } from '../../../lib/toast';
import { TerminalLogViewer } from '../../../components/ui/TerminalLogViewer';
import { LineSteps } from '../../../components/ui/LineSteps';
import { buildModelAPI, cancelBuildAPI, getApiErrorMessage, deployModelAPI } from '../../../lib/api';

const wizardSteps = [
  { id: 1, label: 'Metadata', icon: FileCode2 },
  { id: 2, label: 'Flavor', icon: FlaskConical },
  { id: 3, label: 'Artifact', icon: UploadCloud },
  { id: 4, label: 'Source', icon: Database },
  { id: 5, label: 'Requirements', icon: FileArchive },
  { id: 6, label: 'Deploy', icon: Rocket },
];

export default function BuildPackagePage({
  form,
  setField,
  readRequirementsFile,
  onSubmitting,
  onModelCreated,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
  readRequirementsFile: (file: File | null) => void;
  onSubmitting: (val: boolean) => void;
  onModelCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1);
  const [createdModelId, setCreatedModelId] = useState<string | null>(null);
  const [realPreview, setRealPreview] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const expectedPreview = [
    'model/',
    'model/MLmodel',
    'model/requirements.txt',
    'model/conda.yaml',
    'model/python_env.yaml',
    `model/${form.label_mapping_file?.name ?? 'label_encoder.json'}`,
    `model/${form.source_artifact?.name ?? 'model.pkl'}`,
  ];
  
  const preview = realPreview.length > 0 ? realPreview : expectedPreview;

  const canContinue = () => {
    if (step === 1) return Boolean(form.name.trim());
    if (step === 2) return Boolean(form.flavor);
    if (step === 3) return Boolean(form.source_artifact);
    if (step === 4) return true; // Optional step
    if (step === 6) return Boolean(createdModelId);
    return true;
  };

  const submitBuild = async () => {
    if (createdModelId) {
      setLoading(true);
      onSubmitting(true);
      try {
        await deployModelAPI(createdModelId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });
        navigate(`/dashboard/api-management`);
      } catch (e) {
        onSubmitting(false);
        setLoading(false);
        const msg = getApiErrorMessage(e, "Deployment failed or model is already deploying.");
        toast.error(msg);
      }
    }
  };

  const handleBuildSuccess = (modelId: string, previewTree: string[]) => {
    setCreatedModelId(modelId);
    onModelCreated(modelId);
    setRealPreview(previewTree);
  };

  return (
    <div className="flex flex-col gap-6">
      <LineSteps steps={wizardSteps} currentStep={step} onStepChange={setStep} />

      <div className="rounded-lg border border-gray-300 bg-white p-6">
        {step === 1 && (
          <MetadataStep form={form} setField={setField} />
        )}
        {step === 2 && (
          <FlavorStep form={form} setField={setField} />
        )}
        {step === 3 && (
          <ArtifactStep form={form} setField={setField} />
        )}
        {step === 4 && (
          <SourceStep form={form} setField={setField} />
        )}
        {step === 5 && (
          <RequirementsStep form={form} setField={setField} readRequirementsFile={readRequirementsFile} />
        )}
        {step === 6 && (
          <DeployStep form={form} preview={preview} onBuildSuccess={handleBuildSuccess} canContinue={canContinue()} />
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
          {step < 6 ? (
            <Button
              size="md"
              disabled={!canContinue() || loading}
              onClick={() => setStep((current) => Math.min(6, current + 1))}
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
              onClick={submitBuild}
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

function SourceStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Upload Source Code (Optional)" description="Upload the training source code (.zip or .py) for record-keeping or retraining." />
      <FileDropzone
        accept=".zip,.py"
        title={form.source_code_file ? form.source_code_file.name : 'Choose source code file'}
        subtitle=".zip or .py (Optional)"
        onChange={(file) => setField('source_code_file', file)}
      />

      <StepTitle title="Upload Reference Data (Optional)" description="Upload the dataset (.csv or .zip) used to train the model, for data drift monitoring (Evidently AI)." />
      <FileDropzone
        accept=".zip,.csv"
        title={form.reference_data_file ? form.reference_data_file.name : 'Choose reference data file'}
        subtitle=".zip or .csv (Optional)"
        onChange={(file) => setField('reference_data_file', file)}
      />
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
  onBuildSuccess: (modelId: string, previewTree: string[]) => void;
  canContinue: boolean;
}) {
  const [modelId, setModelId] = useState<string | null>(null);

  const startBuild = async () => {
    try {
      const model = await buildModelAPI(form);
      setModelId(model.id);
    } catch (e) {
      const msg = getApiErrorMessage(e, "Failed to start build process.");
      toast.error(msg);
    }
  };

  const cancelBuild = async () => {
    if (modelId) {
      try {
        await cancelBuildAPI(modelId);
      } catch (e) {
        const msg = getApiErrorMessage(e, "Failed to cancel build process.");
        toast.error(msg);
      }
    }
  };

  const rebuild = async () => {
    if (modelId) {
      try {
        await cancelBuildAPI(modelId);
      } catch (e) {
        const msg = getApiErrorMessage(e, "Failed to cancel build process.");
        toast.error(msg);
      }
    }
    await startBuild();
  };

  return (
    <div className="space-y-5">
      <StepTitle title="Preview & Deploy" description="Review your model configuration, build the MLflow package, and then deploy it as a REST API." />
      
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryItem label="Model" value={form.name || 'Untitled model'} />
        <SummaryItem label="Access" value={`${form.access_mode} API`} />
        <SummaryItem label="Flavor" value={form.flavor} />
        <SummaryItem label="Artifact" value={form.source_artifact?.name || 'Missing artifact'} />
      </div>

      <TerminalLogViewer
        key={modelId || 'idle'}
        modelId={modelId}
        onBuildSuccess={(id, previewTree) => {
          onBuildSuccess(id, previewTree);
        }}
        onRebuild={rebuild}
        onCancel={cancelBuild}
        buildDisabled={!form.source_artifact}
      />
    </div>
  );
}
