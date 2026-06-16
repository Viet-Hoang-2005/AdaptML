import { ArrowLeft, Bot, Boxes, FileArchive, FileCode2, Trash2, UploadCloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useModelAPIMutations, useModelAPIs } from '../../hooks/useModelAPIs';
import type { ModelAccessMode, ModelAPI, ModelAPIFormValues, ModelBuildFormValues } from '../../types/modelApi';
import BuildPackagePage from './BuildPackagePage';
import MLflowZipPage from './MLflowZipPage';

const emptyAdvancedForm: ModelAPIFormValues = {
  name: '',
  description: '',
  model_info: '',
  access_mode: 'public',
  artifact: null,
};

const emptyBuildForm: ModelBuildFormValues = {
  name: '',
  description: '',
  model_info: '',
  access_mode: 'public',
  source_artifact: null,
  flavor: 'sklearn',
  requirements_text: '',
  requirements_file: null,
};

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
      <div className="flex flex-col gap-4 border-b border-gray-300 md:flex-row md:items-end md:justify-between">
        <div className="mb-2">
          <Link to="/dashboard/api-management" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
            Back to API Management
          </Link>
          <h1 className="text-xl font-bold text-gray-900">{editing ? 'Edit model API' : 'Upload model'}</h1>
        </div>
        
        {editing && modelId ? (
          <Button
            variant="danger"
            size="md"
            className="mb-2"
            icon={<Trash2 className="h-4 w-4" />}
            loading={deleting}
            onClick={() => deleteModelAPI(modelId)}
          >
            Disable API
          </Button>
        ) : (
          <nav className="-mb-px flex items-center gap-2" aria-label="Mode Tabs">
            <button
              type="button"
              onClick={() => setMode('builder')}
              className={`inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
                mode === 'builder'
                  ? 'border-black text-gray-950'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-950'
              }`}
            >
              <Bot className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">Auto build package</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('advanced')}
              className={`inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
                mode === 'advanced'
                  ? 'border-black text-gray-950'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-950'
              }`}
            >
              <FileArchive className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">Advanced MLflow ZIP</span>
            </button>
          </nav>
        )}
      </div>

      {editing || mode === 'advanced' ? (
        <MLflowZipPage
          model={model}
          form={advancedForm}
          setField={setAdvancedField}
          submit={submitAdvanced}
          loading={creating || updating}
          editing={editing}
        />
      ) : (
        <BuildPackagePage
          step={step}
          setStep={setStep}
          form={buildForm}
          setField={setBuildField}
          readRequirementsFile={readRequirementsFile}
          preview={expectedPreview}
          submit={submitBuild}
          loading={building}
          canContinue={canContinue}
        />
      )}
    </section>
  );
}

export function StepTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
    </div>
  );
}

export function TextArea({
  id,
  label,
  value,
  onChange,
  placeholder,
  minHeight = 'min-h-24',
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

export function AccessModePicker({
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

export function FileDropzone({
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

export function PackagePreview({ preview, compact = false }: { preview: string[]; compact?: boolean }) {
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

export function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-semibold uppercase text-gray-400">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
