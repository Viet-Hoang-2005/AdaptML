import { Edit3, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getModelBuildMetadata,
  updateModelBuildMetadata,
} from '@/features/build-deploy/api/buildDeployApi';
import { ModelMetadataFields } from '@/features/build-deploy/components/ModelMetadataFields';
import type { ModelBuildFormValues, ModelBuildMetadata } from '@/features/catalog/types';
import { getApiErrorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/Button';
import { toast } from '@/shared/ui/toastStore';

const toForm = (metadata: ModelBuildMetadata): ModelBuildFormValues => ({
  name: metadata.name,
  description: metadata.description,
  access_mode: metadata.access_mode,
  source_artifact: null,
  artifact_format: metadata.artifact_format,
  flavor: metadata.flavor,
  requirements_text: metadata.requirements_text,
});

export function ModelInformationPage({ modelId }: { modelId: string }) {
  const [metadata, setMetadata] = useState<ModelBuildMetadata | null>(null);
  const [form, setForm] = useState<ModelBuildFormValues | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getModelBuildMetadata(modelId)
      .then((result) => {
        setMetadata(result);
        setForm(toForm(result));
      })
      .catch(() => {
        setMetadata(null);
        setForm(null);
      });
  }, [modelId]);

  if (!metadata || !form) {
    return <p className="text-sm text-muted-foreground">Build metadata is available after saving a manual model upload.</p>;
  }

  const setField = (field: keyof ModelBuildFormValues, value: string | File | null) =>
    setForm((current) => current ? { ...current, [field]: value } : current);

  const readRequirementsFile = async (file: File | null) => {
    setField('requirements_file', file);
    if (file) setField('requirements_text', await file.text());
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateModelBuildMetadata(modelId, form);
      setMetadata(result);
      setForm(toForm(result));
      setEditing(false);
      toast.success('Model metadata saved. Build a new image when you are ready to apply it.');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to save model metadata.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Metadata revision r{metadata.revision}. Saving changes does not rebuild the current image.</p>
        {editing ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={() => { setForm(toForm(metadata)); setEditing(false); }}>Cancel</Button>
            <Button size="md" icon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void save()}>Save</Button>
          </div>
        ) : <Button variant="secondary" size="md" icon={<Edit3 className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {editing ? (
        <ModelMetadataFields form={form} assets={metadata.assets} setField={setField} onRequirementsFile={readRequirementsFile} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Info label="Model Name" value={metadata.name} />
          <Info label="Flavor" value={metadata.flavor} />
          <Info label="Access mode" value={metadata.access_mode} />
          <Info label="Artifact" value={metadata.assets.find((asset) => asset.kind === 'source_artifact')?.name ?? '-'} />
          <Info label="Description" value={metadata.description || '-'} />
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{value}</p></div>;
}
