import { Trash2, Rocket } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useState } from 'react';
import type { ModelAPIFormValues } from '../../../types/modelApi';
import { useModelAPIMutations } from '../../../hooks/useModelAPIs';
import { deployModelAPI, deleteModelAPI, cancelBuildAPI, getApiErrorMessage, checkModelEndpointHealth } from '../../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { toast } from '../../../lib/toast';
import { useNavigate } from 'react-router-dom';
import { TerminalLogViewer } from '../../../components/ui/TerminalLogViewer';
import { StepTitle } from '../../../components/ui/StepTitle';
import { AccessModePicker } from '../../../components/ui/Picker';
import { FileDropzone } from '../../../components/ui/FileDropzone';
import { TextArea } from '../../../components/ui/TextArea';

export default function MLflowZipPage({
  form,
  setField,
  onSubmitting,
  onModelCreated,
}: {
  form: ModelAPIFormValues;
  setField: (field: keyof ModelAPIFormValues, value: string | File | null) => void;
  onSubmitting: (val: boolean) => void;
  onModelCreated: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { createModelAPI } = useModelAPIMutations();
  const [createdModelId, setCreatedModelId] = useState<string | null>(null);
  const [isBuildSuccess, setIsBuildSuccess] = useState(false);

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

  const cancelBuild = async () => {
    if (createdModelId) {
      try {
        await cancelBuildAPI(createdModelId);
      } catch (e) {
        const msg = getApiErrorMessage(e, "Failed to cancel build process.");
        toast.error(msg);
      }
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
    setField('version', 'v1');
    setField('artifact', null);
    setIsBuildSuccess(false);
  };

  const handleDeploy = async () => {
    if (!createdModelId) return;
    onSubmitting(true);
    try {
      await deployModelAPI(createdModelId);
      
      let isDeployed = false;
      let attempts = 0;
      const maxAttempts = 30; // 60 seconds timeout
      
      while (!isDeployed && attempts < maxAttempts) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const status = await checkModelEndpointHealth(createdModelId);
          if (status.status === 'deployed') {
            isDeployed = true;
          }
        } catch (err) {
          toast.error(getApiErrorMessage(err, "Endpoint is not healthy yet."));
        }
      }

      if (isDeployed) {
        toast.success("Model deployed successfully!");
      } else {
        toast.error("Deployment is taking longer than expected. Please check model status later.");
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });
      navigate(`/dashboard/api-management`);
    } catch (e) {
      const msg = getApiErrorMessage(e, "Deployment failed.");
      toast.error(msg);
      onSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 rounded-lg border border-gray-300 bg-white p-6 lg:p-8">
      <div>
        <StepTitle title="Advanced MLflow Artifact" description="Upload a .zip package that already contains an MLmodel file." />
        <FileDropzone
          accept=".zip,application/zip"
          title={form.artifact ? form.artifact.name : 'Choose MLflow package'}
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
        <Input
          label="Version"
          value={form.version || 'v1'}
          onChange={(event) => setField('version', event.target.value)}
          placeholder="v1"
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
        <StepTitle title="Upload Source Code & Data (Optional)" description="Upload the training source code and reference data." />
        <FileDropzone
          accept=".zip,.py"
          title={form.source_code_file ? form.source_code_file.name : 'Choose source code file'}
          subtitle=".zip or .py (Optional)"
          onChange={(file) => setField('source_code_file', file)}
        />

        <FileDropzone
          accept=".zip,.csv"
          title={form.reference_data_file ? form.reference_data_file.name : 'Choose reference data file'}
          subtitle=".zip or .csv (Optional)"
          onChange={(file) => setField('reference_data_file', file)}
        />
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

        <p className="mt-6 text-sm font-semibold text-gray-900">MLflow Package Build</p>
        <TerminalLogViewer 
          key={createdModelId || 'idle'}
          modelId={createdModelId}
          onRebuild={submitAdvanced}
          onCancel={cancelBuild}
          buildDisabled={!form.artifact || !form.name.trim()}
          onBuildSuccess={() => {
            setIsBuildSuccess(true);
            toast.success("Build successful! You can now deploy.");
          }}
        />
      </div>

      <div className="flex items-center gap-4 border-t border-gray-200 pt-6">
        <Button
          className="flex-1"
          variant="danger"
          size="md"
          icon={<Trash2 className="h-4 w-4" />}
          disabled={!createdModelId && !form.name && !form.artifact}
          onClick={handleClear}
        >
          Clear
        </Button>
        <Button
          className="flex-1"
          variant="primary"
          size="md"
          icon={<Rocket className="h-4 w-4" />}
          disabled={!isBuildSuccess}
          onClick={handleDeploy}
        >
          Deploy
        </Button>
      </div>
    </div>
  );
}
