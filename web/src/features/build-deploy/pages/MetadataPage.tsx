import { ArrowLeft, ArrowRight} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ModelMetadataFields } from '@/features/build-deploy/components/ModelMetadataFields';
import {
  createModelDraft,
  getModelBuildMetadata,
  updateModelBuildMetadata,
} from '@/features/build-deploy/api/buildDeployApi';
import type { ModelBuildFormValues, ModelBuildMetadata } from '@/features/catalog/types';
import { getApiErrorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/Button';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { PageHeader } from '@/shared/ui/PageHeader';
import { toast } from '@/shared/ui/toastStore';

const emptyForm: ModelBuildFormValues = {
  name: '',
  description: '',
  access_mode: 'public',
  source_artifact: null,
  artifact_format: 'raw',
  flavor: 'sklearn',
  requirements_text: '',
};

const formFromMetadata = (metadata: ModelBuildMetadata): ModelBuildFormValues => ({
  ...emptyForm,
  name: metadata.name,
  description: metadata.description,
  access_mode: metadata.access_mode,
  flavor: metadata.flavor,
  artifact_format: metadata.artifact_format,
  requirements_text: metadata.requirements_text,
});

export default function MetadataPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedModelId = searchParams.get('modelId');
  const [modelId, setModelId] = useState<string | null>(requestedModelId);
  const [metadata, setMetadata] = useState<ModelBuildMetadata | null>(null);
  const [form, setForm] = useState<ModelBuildFormValues>(emptyForm);
  const [loading, setLoading] = useState(Boolean(requestedModelId));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);

  useEffect(() => {
    if (!requestedModelId) return;
    getModelBuildMetadata(requestedModelId)
      .then((result) => {
        setModelId(result.id);
        setMetadata(result);
        setForm(formFromMetadata(result));
        setDirty(false);
      })
      .catch((error) => {
        toast.error(getApiErrorMessage(error, 'Unable to load model metadata.'));
        navigate('/dashboard/management/model/upload/metadata', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [navigate, requestedModelId]);

  const savedSourceArtifact = useMemo(
    () => metadata?.assets.some((asset) => asset.kind === 'source_artifact') ?? false,
    [metadata],
  );

  const setField = (field: keyof ModelBuildFormValues, value: string | File | null) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };

  const readRequirementsFile = async (file: File | null) => {
    setField('requirements_file', file);
    if (file) setField('requirements_text', await file.text());
  };

  const validate = () => {
    const missing = [
      !form.name.trim() && 'Model Name',
      !form.flavor && 'Flavor',
      !form.source_artifact && !savedSourceArtifact && 'Model Artifact',
    ].filter(Boolean) as string[];
    if (!missing.length) return true;
    toast.warning(`Complete the required fields: ${missing.join(', ')}.`);
    document.getElementById(missing[0] === 'Model Name' ? 'metadata-name' : 'metadata-requirements')?.focus();
    return false;
  };

  const persist = async () => {
    if (!validate()) return null;
    setSaving(true);
    try {
      const saved = modelId
        ? await updateModelBuildMetadata(modelId, form)
        : await createModelDraft(form);
      setModelId(saved.id);
      setMetadata(saved);
      setForm(formFromMetadata(saved));
      setDirty(false);
      setSearchParams({ modelId: saved.id }, { replace: true });
      toast.success('Model metadata saved.');
      return saved;
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to save model metadata.'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty) setShowDiscard(true);
    else navigate('/dashboard/management');
  };

  if (loading) return <div className="rounded-lg border border-border bg-surface p-8 text-sm text-muted-foreground">Loading metadata…</div>;

  return (
    <section className="space-y-6">
      <ConfirmModal
        open={showDiscard}
        title="Discard unsaved changes?"
        description="Saved metadata will remain available, but the changes made since your last save will be discarded."
        tone="danger"
        confirmText="Discard changes"
        onConfirm={() => navigate('/dashboard/management')}
        onCancel={() => setShowDiscard(false)}
      />
      <PageHeader title="Create a new model" backLink={{ to: '/dashboard/management', label: 'Back to Model Management' }} />
      <div className="rounded-lg border border-border bg-surface p-6 lg:p-8">
        <ModelMetadataFields form={form} assets={metadata?.assets} setField={setField} onRequirementsFile={readRequirementsFile} />
        <footer className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
          <Button variant="secondary" size="md" icon={<ArrowLeft className="h-4 w-4" />} disabled={saving} onClick={cancel}>Cancel</Button>
          <Button
            variant="secondary"
            size="md"
            loading={saving}
            onClick={async () => {
              const saved = await persist();
              if (saved) navigate('/dashboard/management');
            }}
          >
            - Save -
          </Button>
          <Button size="md" loading={saving} onClick={async () => {
            const saved = await persist();
            if (saved) navigate(`/dashboard/management/model/upload/build-deploy?modelId=${saved.id}`);
          }}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        </footer>
      </div>
    </section>
  );
}
