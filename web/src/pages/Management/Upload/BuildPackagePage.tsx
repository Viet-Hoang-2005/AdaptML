import { useState } from 'react';
import { FileCode2, UploadCloud, FlaskConical, FileArchive, Rocket, ArrowLeft, ArrowRight, Database } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { ModelBuildFormValues, ModelFlavor } from '../../../types/models';
import { SummaryItem } from './UploadModelPage';
import { StepTitle } from '../../../components/ui/StepTitle';
import { FileDropzone } from '../../../components/ui/FileDropzone';
import { TextArea } from '../../../components/ui/TextArea';
import { AccessModePicker } from '../../../components/ui/Picker';
import { toast } from '../../../lib/toast';
import { TerminalLogViewer } from '../../../components/ui/TerminalLogViewer';
import { LineSteps } from '../../../components/ui/LineSteps';
import { buildModelProject, cancelBuildAPI, deployModelProject, triggerModelProjectBuild } from '../../../lib/api';
import { getApiErrorMessage } from '../../../lib/apiError';

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
  const [step, setStep] = useState(1);
  const [createdModelId, setCreatedModelId] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [realPreview, setRealPreview] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const isBento = form.flavor === 'pytorch' || form.flavor === 'tensorflow';
  const expectedPreview = isBento
    ? [
      'bentofile.yaml',
      'service.py',
      'requirements.txt',
      'model/',
      'model/MLmodel',
      `model/${form.source_artifact?.name ?? 'model.pt'}`,
    ]
    : [
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
    if (step === 1) return Boolean(form.name.trim() && (form.version || '').trim());
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
        const model = await deployModelProject(createdModelId);
        setDeploymentId(model.deployment_id || null);
        setLoading(false);
        onSubmitting(false);
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

  const handleDeploymentCompleted = async (status: string) => {
    setLoading(false);
    onSubmitting(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.modelProjects });
    if (status === 'healthy') toast.success('Model deployed successfully!');
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
          <DeployStep
            form={form}
            preview={preview}
            onBuildSuccess={handleBuildSuccess}
            canContinue={canContinue()}
            deploymentId={deploymentId}
            onDeploymentCompleted={handleDeploymentCompleted}
          />
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
              disabled={!canContinue() || !form.name.trim() || Boolean(deploymentId)}
              loading={loading}
              onClick={submitBuild}
            >
              {deploymentId ? 'Deployment running' : 'Deploy model'}
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
      <Input
        label="Version"
        value={form.version || ''}
        onChange={(event) => setField('version', event.target.value)}
        placeholder="e.g. v1, v2, v2-upload-20260627"
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
      <StepTitle title="Upload raw artifact" description="Choose a model file (.pkl, .joblib, .xgb for Tabular; .pt, .pth, .h5, or MLflow .zip for Deep Learning)." />
      <FileDropzone
        accept=".pkl,.joblib,.xgb,.pt,.pth,.h5,.zip"
        title={form.source_artifact ? form.source_artifact.name : 'Choose raw model artifact'}
        subtitle=".pkl, .joblib, .xgb, .pt, .pth, .h5, or .zip"
        onChange={(file) => setField('source_artifact', file)}
      />

      <StepTitle title="Upload Label Mapping (Optional)" description="Choose a dictionary file to map numeric outputs to string labels." />
      <FileDropzone
        accept=".pkl,.json"
        title={form.label_mapping_file ? form.label_mapping_file.name : 'Choose label mapping file'}
        subtitle=".pkl or .json (Optional)"
        onChange={(file) => setField('label_mapping_file', file)}
      />

      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
        <p className="text-sm font-bold text-blue-950">Optional Model Evolution metadata</p>
        <p className="mt-1 text-sm text-blue-800">
          Optional metadata improves Model Evolution comparison and insights. Missing or invalid files will not block deployment.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FileDropzone
          accept=".json,application/json"
          title={form.metrics_file ? form.metrics_file.name : 'Choose metrics.json'}
          subtitle="Optional metrics summary"
          onChange={(file) => setField('metrics_file', file)}
        />
        <FileDropzone
          accept=".json,application/json"
          title={form.params_file ? form.params_file.name : 'Choose params.json'}
          subtitle="Optional parameter summary"
          onChange={(file) => setField('params_file', file)}
        />
        <FileDropzone
          accept=".json,application/json"
          title={form.model_insights_file ? form.model_insights_file.name : 'Choose model_insights.json'}
          subtitle="Optional insights or coefficients"
          onChange={(file) => setField('model_insights_file', file)}
        />
        <FileDropzone
          accept=".json,application/json"
          title={form.feature_importance_file ? form.feature_importance_file.name : 'Choose feature_importance.json'}
          subtitle="Optional feature importance map"
          onChange={(file) => setField('feature_importance_file', file)}
        />
      </div>
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
  const options: Array<{ value: ModelFlavor; title: string; badge: string; description: string }> = [
    { value: 'sklearn', title: 'Scikit-learn', badge: 'FastAPI Lightweight', description: 'Use for sklearn estimators saved as .pkl or .joblib. Packaged with minimal memory footprint.' },
    { value: 'xgboost', title: 'XGBoost', badge: 'FastAPI Lightweight', description: 'Use for XGBoost Booster/XGBModel saved as .xgb, .pkl, or .joblib.' },
    { value: 'pytorch', title: 'PyTorch', badge: '⚡ BentoML Powered', description: 'Deep Learning models (.pt, .pth, or MLflow). Packaged via BentoML with Adaptive Batching & async Redpanda logging.' },
    { value: 'tensorflow', title: 'TensorFlow', badge: '⚡ BentoML Powered', description: 'Deep Learning models (.h5, SavedModel). Packaged via BentoML with optimized multi-core inference.' },
  ];

  const isBentoFlavor = form.flavor === 'pytorch' || form.flavor === 'tensorflow';

  return (
    <div className="space-y-5">
      <StepTitle title="Choose framework flavor" description="Select the machine learning or deep learning framework. Deep Learning models automatically use BentoML Adaptive Batching." />
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((option) => {
          const isSelected = form.flavor === option.value;
          const isBento = option.badge.includes('BentoML');
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setField('flavor', option.value)}
              className={`rounded-2xl border p-5 text-left transition-all ${isSelected
                  ? 'border-black bg-black text-white shadow-lg'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-black'
                }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-bold">{option.title}</span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${isSelected
                    ? isBento ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'
                    : isBento ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                  {option.badge}
                </span>
              </div>
              <p className={`mt-2 text-sm leading-6 ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                {option.description}
              </p>
            </button>
          );
        })}
      </div>

      {isBentoFlavor && (
        <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-purple-950">
            <span>🚀 BentoML Pluggable Packaging Strategy Active</span>
          </div>
          <p className="mt-1 text-sm text-purple-800 leading-relaxed">
            This model will be containerized using BentoML instead of the default FastAPI server. High-throughput prediction requests will be dynamically batched for optimal concurrency while ensuring 100% data drift telemetry via Redpanda/Kafka to Evidently AI.
          </p>
        </div>
      )}
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
  deploymentId,
  onDeploymentCompleted,
}: {
  form: ModelBuildFormValues;
  preview: string[];
  onBuildSuccess: (modelId: string, previewTree: string[]) => void;
  canContinue: boolean;
  deploymentId: string | null;
  onDeploymentCompleted: (status: string) => void;
}) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);

  const startBuild = async () => {
    try {
      const model = await buildModelProject(form);
      setModelId(model.id);
      setBuildId(model.build_id || null);
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
        const model = await triggerModelProjectBuild(modelId);
        setBuildId(model.build_id || null);
      } catch (e) {
        const msg = getApiErrorMessage(e, "Failed to restart build process.");
        toast.error(msg);
      }
      return;
    }
    await startBuild();
  };

  return (
    <div className="space-y-5">
      <StepTitle title="Preview & Deploy" description="Review your model configuration, build the MLflow package, and then deploy it as a REST API." />

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryItem label="Model" value={form.name || 'Untitled model'} />
        <SummaryItem label="Version" value={form.version || 'v1'} />
        <SummaryItem label="Access" value={`${form.access_mode} API`} />
        <SummaryItem label="Flavor" value={form.flavor} />
        <SummaryItem label="Artifact" value={form.source_artifact?.name || 'Missing artifact'} />
        <SummaryItem label="Metrics" value={form.metrics_file?.name || 'Optional'} />
        <SummaryItem label="Insights" value={form.model_insights_file?.name || form.feature_importance_file?.name || 'Optional'} />
      </div>

      <TerminalLogViewer
        key={buildId || 'idle'}
        modelId={modelId}
        buildId={buildId}
        onBuildSuccess={(id, previewTree) => {
          onBuildSuccess(id, previewTree);
        }}
        onRebuild={rebuild}
        onCancel={cancelBuild}
        buildDisabled={!form.source_artifact}
      />
      {deploymentId && (
        <TerminalLogViewer
          key={deploymentId}
          modelId={modelId}
          deploymentId={deploymentId}
          title="Deployment Console"
          onCompleted={onDeploymentCompleted}
        />
      )}
    </div>
  );
}
