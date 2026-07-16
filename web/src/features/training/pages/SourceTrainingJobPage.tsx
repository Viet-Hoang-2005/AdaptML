import { ArrowLeft, ArrowRight, Database, FileCode2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { SourceEditor, type SourceEditorHandle } from '@/features/catalog/components/SourceEditor';
import { useCreateTrainingJob } from '@/features/training/trainingFlowContext';
import type { ModelFlavor } from '@/features/catalog/types';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { StepTitle } from '@/shared/ui/StepTitle';
import { TextArea } from '@/shared/ui/TextArea';

export default function SourceTrainingJobPage() {
  const { t } = useTranslation('training');
  const flow = useCreateTrainingJob();
  const codeEditor = useRef<SourceEditorHandle>(null);
  const dataEditor = useRef<SourceEditorHandle>(null);
  const transitioning = flow.transitionState !== 'idle';

  if (!flow.project) return null;

  return (
    <div className="space-y-8 rounded-lg border border-border bg-surface p-6">
      <StepTitle title={t('createFlow.source.title')} subtitle={t('createFlow.source.description')} />
      <div className="grid gap-5 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
          {t('createFlow.source.flavor')}
          <select
            value={flow.sourceForm.model_flavor}
            onChange={(event) => flow.setSourceField('model_flavor', event.target.value as ModelFlavor)}
            className="h-14 rounded-2xl border border-input bg-surface px-4 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/15"
          >
            <option value="sklearn">Scikit-learn</option>
            <option value="xgboost">XGBoost</option>
            <option value="pytorch">PyTorch</option>
            <option value="tensorflow">TensorFlow</option>
          </select>
        </label>
        <Input
          label={t('createFlow.source.entryPoint')}
          value={flow.sourceForm.entry_point}
          placeholder="train.py"
          onChange={(event) => flow.setSourceField('entry_point', event.target.value)}
        />
      </div>

      <SourceEditor
        ref={codeEditor}
        modelId={flow.project.id}
        fileType="code_file"
        title={t('createFlow.source.sourceCode')}
        icon={<FileCode2 className="h-4 w-4" />}
        accept=".zip,.py,.json,.yaml,.yml"
        editorType="code"
        currentEntryPoint={flow.sourceForm.entry_point}
        onSetEntryPoint={(file) => flow.setSourceField('entry_point', file)}
        onDirtyChange={(dirty) => flow.setEditorDirty('code', dirty)}
      />
      <SourceEditor
        ref={dataEditor}
        modelId={flow.project.id}
        fileType="data_file"
        title={t('createFlow.source.referenceData')}
        icon={<Database className="h-4 w-4" />}
        accept=".zip,.csv,.parquet"
        editorType="csv"
        onDirtyChange={(dirty) => flow.setEditorDirty('data', dirty)}
      />
      <TextArea
        label={t('createFlow.source.requirements')}
        helperText={t('createFlow.source.requirementsHelper')}
        minHeight="min-h-40"
        value={flow.sourceForm.requirements_text}
        placeholder="pandas==2.2.3"
        onChange={(value) => flow.setSourceField('requirements_text', value)}
      />

      <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => void flow.goToStep(1)}>
          {t('createFlow.actions.back')}
        </Button>
        <Button
          loading={flow.transitionState === 'saving-source'}
          disabled={transitioning}
          onClick={() => void flow.continueFromSource([
            async () => codeEditor.current?.save() ?? true,
            async () => dataEditor.current?.save() ?? true,
          ])}
        >
          {t('createFlow.actions.continue')} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
