import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { TextArea } from '@/shared/ui/TextArea';
import { AccessModePicker } from '@/features/catalog/components/AccessModePicker';
import type { ModelProject, ModelProjectFormValues } from '@/features/catalog/types';
import { useModelProjectMutations } from '@/features/catalog/hooks/useModelProjects';

export default function EditModelModal({
  model,
  visible,
  onClose,
}: {
  model: ModelProject | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { updateModelProject, updating } = useModelProjectMutations();
  const [form, setForm] = useState<ModelProjectFormValues>({
    name: model?.name || '',
    description: model?.description || '',
    model_info: model?.model_info || '',
    access_mode: model?.access_mode || 'public',
  });

  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [visible]);



  if (!visible || !model) return null;

  const setField = (field: keyof ModelProjectFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const isDirty = 
    form.name !== model.name ||
    form.description !== model.description ||
    form.model_info !== (model.model_info ?? '') ||
    form.access_mode !== model.access_mode;

  const handleSave = () => {
    if (!isDirty) return;
    updateModelProject({ modelId: model.id, payload: form });
    onClose();
  };

  const handleCancel = () => {
    setForm({
      name: model.name,
      description: model.description,
      model_info: model.model_info ?? '',
      access_mode: model.access_mode,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div 
        className="w-full max-w-xl bg-surface rounded-2xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <h2 className="text-xl font-bold text-foreground">Edit Model API</h2>
          <button 
            onClick={handleCancel}
            className="text-muted-foreground hover:text-muted-foreground transition-colors p-1"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col h-full w-full">
            <div className="flex-1 space-y-5">
              <Input
                label="Model Name"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
              />
              <TextArea
                id="edit-desc"
                label="Description"
                value={form.description}
                onChange={(v) => setField('description', v)}
                placeholder=""
              />
              <TextArea
                id="edit-info"
                label="Model Information"
                value={form.model_info}
                onChange={(v) => setField('model_info', v)}
                placeholder=""
              />
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Access Mode</label>
                <AccessModePicker
                  value={form.access_mode}
                  onChange={(v) => setField('access_mode', v)}
                />
              </div>
            </div>
            
            <div className="mt-8 flex items-center justify-end gap-3 border-t border-border pt-6">
              <Button
                variant="secondary"
                size="md"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                size="md"
                loading={updating}
                disabled={!isDirty}
                onClick={handleSave}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
