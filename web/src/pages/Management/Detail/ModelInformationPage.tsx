import { Edit3 } from 'lucide-react';
import type { ModelProject, ModelProjectFormValues } from '../../../types/models';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { AccessModePicker } from '../../../components/ui/Picker';

interface ModelInformationPageProps {
  model: ModelProject;
  editing: boolean;
  form: ModelProjectFormValues;
  isFormDirty: boolean;
  updating: boolean;
  readOnlyFieldClass: string;
  handleCancelEdit: () => void;
  handleSave: () => void;
  setEditing: (editing: boolean) => void;
  setField: (field: keyof ModelProjectFormValues, value: string) => void;
  setForm: (form: ModelProjectFormValues) => void;
}

export function ModelInformationPage({
  model,
  editing,
  form,
  isFormDirty,
  updating,
  readOnlyFieldClass,
  handleCancelEdit,
  handleSave,
  setEditing,
  setField,
  setForm,
}: ModelInformationPageProps) {
  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex justify-end mb-2">
        {editing ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={handleCancelEdit}>
              Cancel
            </Button>
            <Button
              size="md"
              loading={updating}
              disabled={!isFormDirty}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setForm({
                name: model.name || '',
                description: model.description || '',
                model_info: model.model_info || '',
                access_mode: model.access_mode || 'public',
              });
              setEditing(true);
            }}
          >
            <Edit3 className="h-4 w-4" /> Edit
          </Button>
        )}
      </div>
      
      <div className="flex flex-col flex-1 gap-5">
        <Input
          id="model-name"
          label="Model Name"
          value={editing ? form.name : (model.name || '')}
          onChange={(e) => setField('name', e.target.value)}
          readOnly={!editing}
          tabIndex={!editing ? -1 : undefined}
          className={!editing ? readOnlyFieldClass : ''}
        />
        
        <label htmlFor="model-desc" className="flex flex-col gap-2 text-sm font-medium text-gray-700 shrink-0">
          Description
          <textarea
            id="model-desc"
            className={`text-sm text-gray-800 placeholder-gray-400 font-normal placeholder:font-normal h-25 w-full resize-y rounded-2xl border border-gray-300 bg-white py-3 px-4 outline-none transition-colors duration-200 disabled:bg-gray-50 disabled:text-gray-400 ${
              editing ? 'hover:border-black focus:border-black' : 'cursor-default hover:border-gray-300 focus:border-gray-300'
            }`}
            value={editing ? form.description : (model.description || '')}
            onChange={(e) => setField('description', e.target.value)}
            readOnly={!editing}
            tabIndex={!editing ? -1 : undefined}
          />
        </label>

        <label htmlFor="model-info" className="flex flex-col flex-1 gap-2 text-sm font-medium text-gray-700">
          Model Information
          <textarea
            id="model-info"
            className={`text-sm text-gray-800 placeholder-gray-400 font-normal placeholder:font-normal flex-1 w-full resize-y rounded-2xl border border-gray-300 bg-white py-3 px-4 outline-none transition-colors duration-200 disabled:bg-gray-50 disabled:text-gray-400 ${
              editing ? 'hover:border-black focus:border-black' : 'cursor-default hover:border-gray-300 focus:border-gray-300'
            }`}
            value={editing ? form.model_info : (model.model_info || '')}
            onChange={(e) => setField('model_info', e.target.value)}
            readOnly={!editing}
            tabIndex={!editing ? -1 : undefined}
          />
        </label>

        <div className="shrink-0">
          <label className="text-sm font-medium text-gray-700 mb-2 block">Access Mode</label>
          <AccessModePicker
            value={editing ? form.access_mode : (model.access_mode || 'public')}
            onChange={(v) => editing && setField('access_mode', v)}
          />
        </div>
      </div>
    </div>
  );
}
