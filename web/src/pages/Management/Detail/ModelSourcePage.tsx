import { FileCode2, Database } from 'lucide-react';
import type { ModelAPI } from '../../../types/modelApi';
import { SourceEditor } from '../../../components/ui/SourceEditor';

interface ModelSourcePageProps {
  model: ModelAPI;
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
        modelApi={model} 
        fileType="source_code_file"
        title="Source Code"
        icon={<FileCode2 className="w-4 h-4" />}
        accept=".zip,.py"
        defaultFilename="main.py"
        editorType="code"
        onDirtyChange={setSourceCodeDirty}
      />
      <SourceEditor
        modelApi={model} 
        fileType="reference_data_file"
        title="Reference Data"
        icon={<Database className="w-4 h-4" />}
        accept=".zip,.csv"
        defaultFilename="data.csv"
        editorType="csv"
        onDirtyChange={setReferenceDataDirty}
      />
    </div>
  );
}
