import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCreateTrainingJob } from '@/features/training/trainingFlowContext';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { StepTitle } from '@/shared/ui/StepTitle';
import { Switch } from '@/shared/ui/Switch';
import { TextArea } from '@/shared/ui/TextArea';

export default function MetadataTrainingJobPage() {
  const { t } = useTranslation('training');
  const flow = useCreateTrainingJob();
  const transitioning = flow.transitionState !== 'idle';

  return (
    <div className="space-y-6 rounded-lg border border-border bg-surface p-6">
      <StepTitle
        title={t('createFlow.metadata.title')}
        subtitle={t('createFlow.metadata.description')}
      />
      <Switch
        value={flow.mode}
        onChange={(mode) => flow.setMode(mode)}
        ariaLabel={t('createFlow.metadata.modeLabel')}
        options={[
          { value: 'new', title: t('createFlow.metadata.newModel') },
          { value: 'existing', title: t('createFlow.metadata.existingModel') },
        ]}
      />

      {flow.mode === 'existing' && (
        <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
          {t('createFlow.metadata.selectModel')}
          <select
            value={flow.project?.id ?? ''}
            onChange={(event) => flow.selectProject(event.target.value)}
            className="h-14 rounded-2xl border border-input bg-surface px-4 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/15"
          >
            <option value="">{t('createFlow.metadata.selectPlaceholder')}</option>
            {flow.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
      )}

      <Input
        id="training-model-name"
        label={t('createFlow.metadata.name')}
        placeholder={t('createFlow.metadata.namePlaceholder')}
        value={flow.metadataForm.name}
        onChange={(event) => flow.setMetadataField('name', event.target.value)}
      />
      <TextArea
        label={t('createFlow.metadata.modelDescription')}
        placeholder={t('createFlow.metadata.descriptionPlaceholder')}
        value={flow.metadataForm.description}
        onChange={(value) => flow.setMetadataField('description', value)}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('createFlow.metadata.accessMode')}</p>
        <Switch
          value={flow.metadataForm.access_mode}
          onChange={(value) => flow.setMetadataField('access_mode', value)}
          ariaLabel={t('createFlow.metadata.accessMode')}
          options={[
            { value: 'private', title: t('createFlow.metadata.private') },
            { value: 'public', title: t('createFlow.metadata.public') },
          ]}
        />
      </div>

      <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => flow.requestExit()}>
          {t('createFlow.actions.back')}
        </Button>
        <Button
          loading={flow.transitionState === 'saving-metadata'}
          disabled={transitioning}
          onClick={() => void flow.continueFromMetadata()}
        >
          {t('createFlow.actions.continue')} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
