import {
  ArrowLeft,
  Boxes,
  FileArchive,
  FileCode2,
  FlaskConical,
  ListTree,
  Rocket,
  Save,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useModelAPIMutations, useModelAPIs } from '../../hooks/useModelAPIs';
import type {
  ModelAccessMode,
  ModelAPI,
  ModelAPIFormValues,
  ModelBuildFormValues,
  ModelFlavor,
} from '../../types/modelApi';

const emptyAdvancedForm: ModelAPIFormValues = {
  name: '',
  description: '',
  model_info: '',
  access_mode: 'private',
  artifact: null,
};

const emptyBuildForm: ModelBuildFormValues = {
  name: '',
  description: '',
  model_info: '',
  access_mode: 'private',
  source_artifact: null,
  flavor: 'sklearn',
  requirements_text: '',
  requirements_file: null,
};

const wizardSteps = [
  { id: 1, label: 'Metadata', icon: FileCode2 },
  { id: 2, label: 'Artifact', icon: UploadCloud },
  { id: 3, label: 'Flavor', icon: FlaskConical },
  { id: 4, label: 'Requirements', icon: FileArchive },
  { id: 5, label: 'Preview', icon: ListTree },
  { id: 6, label: 'Deploy', icon: Rocket },
];

export default function ModelAPIFormPage() {
  const params = useParams();
  const modelId = params.modelId ? Number(params.modelId) : null;
  const editing = Boolean(modelId);
  const { data } = useModelAPIs();
  const model = useMemo(() => data?.models.find((item) => item.id === modelId) ?? null, [data?.models, modelId]);

  return (
    <ModelAPIFormContent
      key={model?.id ?? 'new-model-api'}
      editing={editing}
      model={model}
      modelId={modelId}
    />
  );
}

function ModelAPIFormContent({
  editing,
  model,
  modelId,
}: {
  editing: boolean;
  model: ModelAPI | null;
  modelId: number | null;
}) {
  const {
    buildModelAPI,
    createModelAPI,
    updateModelAPI,
    deleteModelAPI,
    building,
    creating,
    updating,
    deleting,
  } = useModelAPIMutations();
  const [mode, setMode] = useState<'builder' | 'advanced'>('builder');
  const [step, setStep] = useState(1);
  const [advancedForm, setAdvancedForm] = useState<ModelAPIFormValues>(() =>
    model
      ? {
        name: model.name,
        description: model.description,
        model_info: model.model_info,
        access_mode: model.access_mode,
        artifact: null,
      }
      : emptyAdvancedForm,
  );
  const [buildForm, setBuildForm] = useState<ModelBuildFormValues>(() =>
    model
      ? {
        name: model.name,
        description: model.description,
        model_info: model.model_info,
        access_mode: model.access_mode,
        source_artifact: null,
        flavor: model.flavor || 'sklearn',
        requirements_text: model.requirements_text || '',
        requirements_file: null,
      }
      : emptyBuildForm,
  );

  const setAdvancedField = (field: keyof ModelAPIFormValues, value: string | File | null) => {
    setAdvancedForm((current) => ({ ...current, [field]: value }));
  };

  const setBuildField = (field: keyof ModelBuildFormValues, value: string | File | null) => {
    setBuildForm((current) => ({ ...current, [field]: value }));
  };

  const expectedPreview = [
    'model/',
    'model/MLmodel',
    'model/requirements.txt',
    'model/python_env.yaml',
    `model/artifacts/${buildForm.source_artifact?.name ?? '<raw-model-artifact>'}`,
  ];

  const canContinue = () => {
    if (step === 1) return Boolean(buildForm.name.trim());
    if (step === 2) return Boolean(buildForm.source_artifact);
    if (step === 3) return Boolean(buildForm.flavor);
    return true;
  };

  const submitAdvanced = () => {
    if (editing && modelId) {
      updateModelAPI({ modelId, payload: advancedForm });
      return;
    }
    createModelAPI(advancedForm);
  };

  const submitBuild = () => {
    buildModelAPI(buildForm);
  };

  const readRequirementsFile = async (file: File | null) => {
    setBuildField('requirements_file', file);
    if (!file) return;
    const text = await file.text();
    setBuildField('requirements_text', text);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Link to="/dashboard/api-management" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
            Back to API Management
          </Link>
          <h1 className="text-xl font-bold text-gray-900">{editing ? 'Edit model API' : 'Upload model'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {editing ? 'Update endpoint metadata or replace the MLflow package.' : 'Build an MLflow package from a raw model artifact, or upload a ready-made MLflow ZIP.'}
          </p>
        </div>
        {editing && modelId && (
          <Button
            variant="danger"
            size="md"
            icon={<Trash2 className="h-4 w-4" />}
            loading={deleting}
            onClick={() => deleteModelAPI(modelId)}
          >
            Disable API
          </Button>
        )}
      </div>

      {!editing && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode('builder')}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${mode === 'builder' ? 'border-black bg-black text-white' : 'border-gray-300 bg-white text-gray-600 hover:text-black'}`}
          >
            Auto build package
          </button>
          <button
            type="button"
            onClick={() => setMode('advanced')}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${mode === 'advanced' ? 'border-black bg-black text-white' : 'border-gray-300 bg-white text-gray-600 hover:text-black'}`}
          >
            Advanced MLflow ZIP
          </button>
        </div>
      )}

      {editing || mode === 'advanced' ? (
        <AdvancedUploadForm
          model={model}
          form={advancedForm}
          setField={setAdvancedField}
          submit={submitAdvanced}
          loading={creating || updating}
          editing={editing}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-lg border border-gray-300 bg-white p-4">
            <div className="space-y-1">
              {wizardSteps.map((item) => {
                const Icon = item.icon;
                const active = step === item.id;
                const done = step > item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStep(item.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors ${
                      active
                        ? 'bg-black text-white'
                        : done
                          ? 'text-gray-900 hover:bg-gray-100'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="rounded-lg border border-gray-300 bg-white p-6">
            {step === 1 && (
              <MetadataStep form={buildForm} setField={setBuildField} />
            )}
            {step === 2 && (
              <ArtifactStep form={buildForm} setField={setBuildField} />
            )}
            {step === 3 && (
              <FlavorStep form={buildForm} setField={setBuildField} />
            )}
            {step === 4 && (
              <RequirementsStep form={buildForm} setField={setBuildField} readRequirementsFile={readRequirementsFile} />
            )}
            {step === 5 && (
              <PreviewStep preview={expectedPreview} form={buildForm} />
            )}
            {step === 6 && (
              <DeployStep form={buildForm} preview={expectedPreview} submit={submitBuild} loading={building} />
            )}

            <div className="mt-8 flex justify-between border-t border-gray-200 pt-5">
              <Button
                variant="secondary"
                size="md"
                disabled={step === 1 || building}
                onClick={() => setStep((current) => Math.max(1, current - 1))}
              >
                Back
              </Button>
              {step < 6 ? (
                <Button
                  size="md"
                  disabled={!canContinue() || building}
                  onClick={() => setStep((current) => Math.min(6, current + 1))}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  size="md"
                  icon={<Rocket className="h-4 w-4" />}
                  disabled={!buildForm.source_artifact || !buildForm.name.trim()}
                  loading={building}
                  onClick={submitBuild}
                >
                  Deploy model
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
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

function PreviewStep({ preview, form }: { preview: string[]; form: ModelBuildFormValues }) {
  return (
    <div className="space-y-5">
      <StepTitle title="Preview package structure" description="This is the expected MLflow package layout. Django stores the actual generated preview after deploy." />
      <PackagePreview preview={preview} />
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        Flavor: <span className="font-semibold text-gray-900">{form.flavor}</span>
      </div>
    </div>
  );
}

function DeployStep({
  form,
  preview,
  submit,
  loading,
}: {
  form: ModelBuildFormValues;
  preview: string[];
  submit: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Deploy model API" description="The Control Plane will build the MLflow package, upload it to S3, then expose a model endpoint." />
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryItem label="Model" value={form.name || 'Untitled model'} />
        <SummaryItem label="Access" value={`${form.access_mode} API`} />
        <SummaryItem label="Flavor" value={form.flavor} />
        <SummaryItem label="Artifact" value={form.source_artifact?.name || 'Missing artifact'} />
      </div>
      <PackagePreview preview={preview} />
      <Button
        size="md"
        icon={<Rocket className="h-4 w-4" />}
        loading={loading}
        disabled={!form.name.trim() || !form.source_artifact}
        onClick={submit}
      >
        Build and deploy
      </Button>
    </div>
  );
}

function AdvancedUploadForm({
  model,
  form,
  setField,
  submit,
  loading,
  editing,
}: {
  model: ModelAPI | null;
  form: ModelAPIFormValues;
  setField: (field: keyof ModelAPIFormValues, value: string | File | null) => void;
  submit: () => void;
  loading: boolean;
  editing: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5 rounded-lg border border-gray-300 bg-white p-6">
        <Input
          label="Model Name"
          value={form.name}
          onChange={(event) => setField('name', event.target.value)}
          placeholder="e.g. CICIDS Classifier"
        />
        <TextArea
          id="advanced-description"
          label="Description"
          value={form.description}
          onChange={(value) => setField('description', value)}
          placeholder="What does this model classify or detect?"
        />
        <TextArea
          id="advanced-model-info"
          label="Model Information"
          value={form.model_info}
          onChange={(value) => setField('model_info', value)}
          placeholder="Framework, labels, expected inputs, F1 score, or other notes."
        />
        <AccessModePicker value={form.access_mode} onChange={(value) => setField('access_mode', value)} />
      </div>

      <aside className="space-y-4 rounded-lg border border-gray-300 bg-white p-6">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Advanced MLflow Artifact</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            Upload a `.zip` package that already contains an `MLmodel` file.
          </p>
        </div>

        <FileDropzone
          accept=".zip,application/zip"
          title={form.artifact ? form.artifact.name : editing ? 'Replace model artifact' : 'Choose MLflow package'}
          subtitle="ZIP only"
          onChange={(file) => setField('artifact', file)}
        />

        {model?.package_preview_tree?.length ? (
          <PackagePreview preview={model.package_preview_tree} compact />
        ) : null}

        {model?.endpoint_url && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-gray-400">Current Endpoint</p>
            <code className="block break-all rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{model.endpoint_url}</code>
          </div>
        )}

        <Button
          fullWidth
          size="md"
          icon={<Save className="h-4 w-4" />}
          loading={loading}
          onClick={submit}
        >
          {editing ? 'Save changes' : 'Create Model API'}
        </Button>
      </aside>
    </div>
  );
}

function StepTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
    </div>
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  placeholder,
  minHeight = 'min-h-28',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minHeight?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${minHeight} w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors hover:border-black focus:border-black`}
        placeholder={placeholder}
      />
    </div>
  );
}

function AccessModePicker({
  value,
  onChange,
}: {
  value: ModelAccessMode;
  onChange: (value: ModelAccessMode) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['private', 'public'] as ModelAccessMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
            value === mode
              ? 'border-black bg-black text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:border-black'
          }`}
        >
          <span className="text-sm font-bold capitalize">{mode} API</span>
          <p className={`mt-1 text-xs ${value === mode ? 'text-gray-300' : 'text-gray-500'}`}>
            {mode === 'private' ? 'Requires JWT or API key.' : 'Allows public prediction requests.'}
          </p>
        </button>
      ))}
    </div>
  );
}

function FileDropzone({
  accept,
  title,
  subtitle,
  onChange,
}: {
  accept: string;
  title: string;
  subtitle: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 text-center hover:border-black">
      <UploadCloud className="mb-3 h-6 w-6 text-gray-500" />
      <span className="max-w-full truncate text-sm font-semibold text-gray-900">{title}</span>
      <span className="mt-1 text-xs text-gray-500">{subtitle}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function PackagePreview({ preview, compact = false }: { preview: string[]; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-gray-950 p-4 font-mono text-xs text-gray-100 ${compact ? 'max-h-48 overflow-auto' : ''}`}>
      {preview.map((item) => (
        <div key={item} className="flex items-center gap-2 py-1">
          {item.endsWith('/') ? <Boxes className="h-3.5 w-3.5 text-blue-300" /> : <FileCode2 className="h-3.5 w-3.5 text-gray-400" />}
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-semibold uppercase text-gray-400">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
