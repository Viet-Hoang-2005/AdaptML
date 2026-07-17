import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCreateTrainingJob } from '@/features/training/trainingFlowContext';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { StepTitle } from '@/shared/ui/StepTitle';
import { Switch } from '@/shared/ui/Switch';
import { Picker } from '@/shared/ui/Picker';
import { Select } from '@/shared/ui/Select';
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
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('createFlow.metadata.selectModel')}</p>
          <Select
            value={flow.project?.id ?? ''}
            onChange={(value) => flow.selectProject(value)}
            placeholder={t('createFlow.metadata.selectPlaceholder')}
            options={flow.projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
          />
        </div>
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
        <Picker
          value={flow.metadataForm.access_mode}
          onChange={(value) => flow.setMetadataField('access_mode', value as 'public' | 'private')}
          options={[
            { value: 'private', title: 'Private API', description: 'Requires JWT or API key.' },
            { value: 'public', title: 'Public API', description: 'Allows public prediction requests.' },
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
