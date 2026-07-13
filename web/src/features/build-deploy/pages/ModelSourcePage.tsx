import { FileCode2, Database } from 'lucide-react';
import type { ModelProject } from '@/features/catalog/types';
import { SourceEditor } from '@/features/catalog/components/SourceEditor';

interface ModelSourcePageProps {
  model: ModelProject;
  setSourceCodeDirty: (dirty: boolean) => void;
  setReferenceDataDirty: (dirty: boolean) => void;
}

export function ModelSourcePage({
  model,
  setSourceCodeDirty,
  setReferenceDataDirty,
}: ModelSourcePageProps) {
  return (
    <div className="flex-1 w-full h-full min-h-150 flex flex-col gap-6">
      <SourceEditor 
        modelId={model.id.toString()} 
        fileType="code_file"
        title="Source Code"
        icon={<FileCode2 className="w-4 h-4" />}
        accept=".zip,.py"
        editorType="code"
        onDirtyChange={setSourceCodeDirty}
      />
      <SourceEditor
        modelId={model.id.toString()} 
        fileType="data_file"
        title="Reference Data"
        icon={<Database className="w-4 h-4" />}
        accept=".zip,.csv"
        editorType="csv"
        onDirtyChange={setReferenceDataDirty}
      />
    </div>
  );
}
