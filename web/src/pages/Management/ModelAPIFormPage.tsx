import { ArrowLeft, Save, Trash2, UploadCloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useModelAPIMutations, useModelAPIs } from '../../hooks/useModelAPIs';
import type { ModelAccessMode, ModelAPI, ModelAPIFormValues } from '../../types/modelApi';

const emptyForm: ModelAPIFormValues = {
  name: '',
  description: '',
  model_info: '',
  access_mode: 'private',
  artifact: null,
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
  const { createModelAPI, updateModelAPI, deleteModelAPI, creating, updating, deleting } = useModelAPIMutations();
  const [form, setForm] = useState<ModelAPIFormValues>(() =>
    model
      ? {
        name: model.name,
        description: model.description,
        model_info: model.model_info,
        access_mode: model.access_mode,
        artifact: null,
      }
      : emptyForm,
  );

  const setField = (field: keyof ModelAPIFormValues, value: string | File | null) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = () => {
    if (editing && modelId) {
      updateModelAPI({ modelId, payload: form });
      return;
    }
    createModelAPI(form);
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
          <p className="mt-1 text-sm text-gray-500">Upload an MLflow zip package and configure endpoint access.</p>
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

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5 rounded-lg border border-gray-300 bg-white p-6">
          <Input
            label="Model Name"
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder="e.g. CICIDS Classifier"
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="model-description" className="text-sm font-medium text-gray-700">Description</label>
            <textarea
              id="model-description"
              value={form.description}
              onChange={(event) => setField('description', event.target.value)}
              className="min-h-28 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors hover:border-black focus:border-black"
              placeholder="What does this model classify or detect?"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="model-info" className="text-sm font-medium text-gray-700">Model Information</label>
            <textarea
              id="model-info"
              value={form.model_info}
              onChange={(event) => setField('model_info', event.target.value)}
              className="min-h-32 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors hover:border-black focus:border-black"
              placeholder="Framework, labels, expected inputs, F1 score, or other notes."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(['private', 'public'] as ModelAccessMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setField('access_mode', mode)}
                className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                  form.access_mode === mode
                    ? 'border-black bg-black text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-black'
                }`}
              >
                <span className="text-sm font-bold capitalize">{mode} API</span>
                <p className={`mt-1 text-xs ${form.access_mode === mode ? 'text-gray-300' : 'text-gray-500'}`}>
                  {mode === 'private' ? 'Requires JWT or API key.' : 'Allows public prediction requests.'}
                </p>
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-4 rounded-lg border border-gray-300 bg-white p-6">
          <div>
            <h2 className="text-sm font-bold text-gray-900">MLflow Artifact</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              Upload a `.zip` package that contains an `MLmodel` file.
            </p>
          </div>

          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 text-center hover:border-black">
            <UploadCloud className="mb-3 h-6 w-6 text-gray-500" />
            <span className="text-sm font-semibold text-gray-900">
              {form.artifact ? form.artifact.name : editing ? 'Replace model artifact' : 'Choose model artifact'}
            </span>
            <span className="mt-1 text-xs text-gray-500">ZIP only</span>
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => setField('artifact', event.target.files?.[0] ?? null)}
            />
          </label>

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
            loading={creating || updating}
            onClick={submit}
          >
            {editing ? 'Save changes' : 'Create Model API'}
          </Button>
        </aside>
      </div>
    </section>
  );
}
