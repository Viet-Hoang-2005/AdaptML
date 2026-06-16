import { Save, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import type { ModelAPI, ModelAPIFormValues } from '../../types/modelApi';
import { AccessModePicker, FileDropzone, PackagePreview, TextArea, } from './UploadModelFormPage';

export default function MLflowZipPage({
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
  const handleClear = () => {
    setField('name', '');
    setField('description', '');
    setField('model_info', '');
    setField('access_mode', 'public');
    setField('artifact', null);
  };

  return (
    <div className="space-y-6 rounded-lg border border-gray-300 bg-white p-6 lg:p-8">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Advanced MLflow Artifact</h2>
        <p className="mb-4 mt-1 text-sm leading-6 text-gray-500">
          Upload a `.zip` package that already contains an `MLmodel` file.
        </p>
        <FileDropzone
          accept=".zip,application/zip"
          title={form.artifact ? form.artifact.name : editing ? 'Replace model artifact' : 'Choose MLflow package'}
          subtitle="ZIP only"
          onChange={(file) => setField('artifact', file)}
        />
      </div>

      <div className="space-y-5 border-t border-gray-200 pt-6">
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

      {model?.package_preview_tree?.length ? (
        <div className="border-t border-gray-200 pt-6">
          <p className="mb-2 text-sm font-semibold text-gray-900">Package Preview</p>
          <PackagePreview preview={model.package_preview_tree} compact />
        </div>
      ) : null}

      {model?.endpoint_url && (
        <div className="border-t border-gray-200 pt-6">
          <p className="mb-2 text-xs font-semibold uppercase text-gray-400">Current Endpoint</p>
          <code className="block break-all rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{model.endpoint_url}</code>
        </div>
      )}

      <div className="flex items-center gap-4 border-t border-gray-200 pt-6">
        <Button
          className="flex-1"
          variant="danger"
          size="md"
          icon={<Trash2 className="h-4 w-4" />}
          disabled={loading}
          onClick={handleClear}
        >
          Delete
        </Button>
        <Button
          className="flex-1"
          size="md"
          icon={<Save className="h-4 w-4" />}
          loading={loading}
          onClick={submit}
        >
          {editing ? 'Save changes' : 'Create Model API'}
        </Button>
      </div>
    </div>
  );
}
