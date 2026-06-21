import { Rocket, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import type { ModelAPIFormValues } from '../../types/modelApi';
import { FileDropzone, StepTitle } from './UploadModelFormPage';
import { PackagePreview } from '../../components/ui/PackagePreview';
import { TextArea } from '../../components/ui/TextArea';
import { AccessModePicker } from '../../components/ui/Picker';
import { useModelAPIMutations } from '../../hooks/useModelAPIs';
import { TerminalLogViewer } from '../../components/ui/TerminalLogViewer';
import { deployModelAPI, deleteModelAPI, getApiErrorMessage } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../../components/ui/ConfirmModal';

export default function MLflowZipPage({
  form,
  setField,
  onSubmitting,
  onModelCreated,
}: {
  form: ModelAPIFormValues;
  setField: (field: keyof ModelAPIFormValues, value: string | File | null) => void;
  onSubmitting: (val: boolean) => void;
  onModelCreated: (id: number | null) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { createModelAPI, creating } = useModelAPIMutations();
  const [createdModelId, setCreatedModelId] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
 
  const submitAdvanced = async () => {
    onSubmitting(true);
    try {
      const model = await createModelAPI(form);
      setCreatedModelId(model.id);
      onModelCreated(model.id);
    } catch (e) {
      const msg = getApiErrorMessage(e, "Failed to create model");
      toast.error(msg);
      onSubmitting(false);
    }
  };
  const handleClear = async () => {
    if (createdModelId) {
      onSubmitting(true);
      try {
        await deleteModelAPI(createdModelId, true);
      } catch (e) {
        const msg = getApiErrorMessage(e, "Failed to delete model");
        toast.error(msg);
      } finally {
        onSubmitting(false);
      }
      setCreatedModelId(null);
      onModelCreated(null);
    }
    setField('name', '');
    setField('description', '');
    setField('model_info', '');
    setField('access_mode', 'public');
    setField('artifact', null);
    setShowClearConfirm(false);
  };

  const samplePreviewTree = [
    'model/',
    'model/MLmodel',
    'model/requirements.txt',
    'model/conda.yaml',
    'model/python_env.yaml',
    'model/label_encoder.json',
    'model/model.pkl'
  ];

  return (
    <>
    <ConfirmModal
      open={showClearConfirm}
      title="Clear Form Data?"
      description="Are you sure you want to clear all data and cancel any running build? This action cannot be undone."
      tone="danger"
      confirmText="Confirm"
      onConfirm={handleClear}
      onCancel={() => setShowClearConfirm(false)}
    />
    <div className="space-y-6 rounded-lg border border-gray-300 bg-white p-6 lg:p-8">
      <div className='space-y-4'>
        <StepTitle
          title="Model Metadata"
          description="Describe the model and decide whether the prediction API is public or private."
        />
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

      <div className="space-y-4 border-t border-gray-200 pt-6">
        <StepTitle
          title="MLflow Package"
          description="Upload a .zip package that already contains an MLmodel file."
        />
        <FileDropzone
          accept=".zip,application/zip"
          title={form.artifact ? form.artifact.name : 'Choose MLflow package'}
          subtitle="ZIP only"
          onChange={(file) => setField('artifact', file)}
        />

        <p className="mt-6 text-sm font-semibold text-gray-900">Required Package Structure</p>
        <PackagePreview preview={samplePreviewTree} compact />

        <p className="mt-6 text-sm font-semibold text-gray-900">MLflow Package Build</p>
        <TerminalLogViewer 
          key={createdModelId || 'idle'}
          modelId={createdModelId}
          onRebuild={submitAdvanced}
          buildDisabled={!form.artifact || !form.name.trim() || creating}
          onBuildSuccess={async (modelId) => {
            onSubmitting(true);
            try {
              await deployModelAPI(modelId);
              await queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });
              navigate(`/dashboard/api-management`);
            } catch (e) {
              const msg = getApiErrorMessage(e, "Deployment failed.");
              toast.error(msg);
            }
          }}
        />
      </div>

      <div className="flex items-center gap-4 border-t border-gray-200 pt-6">
        <Button
          className="flex-1"
          variant="danger"
          size="md"
          icon={<Trash2 className="h-4 w-4" />}
          disabled={creating}
          onClick={() => setShowClearConfirm(true)}
        >
          Clear
        </Button>
        <Button
          className="flex-1"
          size="md"
          icon={<Rocket className="h-4 w-4" />}
          loading={creating}
          disabled={!!createdModelId || !form.artifact || !form.name.trim()}
          onClick={submitAdvanced}
        >
          Deploy model
        </Button>
      </div>
    </div>
    </>
  );
}
