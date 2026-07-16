import { ArrowLeft, Check, Clock, Cpu, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCreateTrainingJob } from '@/features/training/trainingFlowContext';
import type { TrainingAcceleratorType } from '@/features/training/types';
import { Button } from '@/shared/ui/Button';
import { Slider } from '@/shared/ui/Slider';
import { StepTitle } from '@/shared/ui/StepTitle';
import { SummaryCard } from '@/shared/ui/SummaryCard';
import { TerminalViewer } from '@/shared/ui/TerminalViewer';

const runtimeOptions = [
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
  { label: '2h', value: 7200 },
  { label: '6h', value: 21600 },
  { label: '12h', value: 43200 },
];

export default function ExecutionTrainingJobPage() {
  const { t } = useTranslation('training');
  const flow = useCreateTrainingJob();
  const active = flow.job && ['pending', 'queued', 'uploading', 'running'].includes(flow.job.status);
  const profiles = flow.capabilities?.cpu_profiles ?? [];
  const accelerators = flow.capabilities?.accelerators ?? [{ type: 'none' as const, counts: [0] }];

  return (
    <div className="space-y-6 rounded-lg border border-border bg-surface p-6">
      <StepTitle title={t('createFlow.execution.title')} subtitle={t('createFlow.execution.description')} />
      <div className="grid gap-4 md:grid-cols-3">
        {profiles.map((profile) => {
          const selected = profile.vcpu === flow.executionForm.vcpu && profile.memory_mb === flow.executionForm.memory_mb;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => {
                flow.setExecutionField('vcpu', profile.vcpu);
                flow.setExecutionField('memory_mb', profile.memory_mb);
              }}
              className={`rounded-xl border p-4 text-left transition-colors ${selected ? 'border-primary bg-primary-subtle ring-1 ring-primary' : 'border-border bg-surface hover:border-primary'}`}
            >
              <p className="font-semibold capitalize text-foreground">{profile.id}</p>
              <p className="mt-2 text-sm text-muted-foreground">{profile.vcpu} vCPU / {profile.memory_mb} MB</p>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">{t('createFlow.execution.accelerator')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {accelerators.flatMap((accelerator) => accelerator.counts.map((count) => {
            const selected = flow.executionForm.accelerator_type === accelerator.type
              && flow.executionForm.accelerator_count === count;
            return (
              <button
                key={`${accelerator.type}-${count}`}
                type="button"
                onClick={() => {
                  flow.setExecutionField('accelerator_type', accelerator.type as TrainingAcceleratorType);
                  flow.setExecutionField('accelerator_count', count);
                }}
                className={`rounded-xl border p-3 text-left ${selected ? 'border-primary bg-primary-subtle ring-1 ring-primary' : 'border-border bg-surface hover:border-primary'}`}
              >
                <p className="font-semibold text-foreground">
                  {accelerator.type === 'none' ? t('createFlow.execution.cpuOnly') : `GPU x${count}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{flow.capabilities?.backend ?? '-'}</p>
              </button>
            );
          }))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-foreground">{t('createFlow.execution.maxRuntime')}</p>
        <Slider
          options={runtimeOptions}
          value={flow.executionForm.max_runtime_seconds}
          onChange={(value) => flow.setExecutionField('max_runtime_seconds', value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label={t('createFlow.execution.model')} value={flow.project?.name ?? '-'} icon={<Cpu className="h-4 w-4" />} />
        <SummaryCard label={t('createFlow.source.flavor')} value={flow.sourceForm.model_flavor} icon={<Zap className="h-4 w-4" />} />
        <SummaryCard label={t('createFlow.execution.compute')} value={`${flow.executionForm.vcpu} vCPU / ${flow.executionForm.memory_mb} MB`} icon={<Cpu className="h-4 w-4" />} />
        <SummaryCard label={t('createFlow.execution.maxRuntime')} value={`${flow.executionForm.max_runtime_seconds / 60} min`} icon={<Clock className="h-4 w-4" />} />
      </div>

      <TerminalViewer
        key={flow.job?.id ?? 'new-training'}
        trainingJobId={flow.job?.id}
        title={t('createFlow.execution.console')}
        placeholder={t('createFlow.execution.placeholder')}
        startLabel={t('createFlow.execution.train')}
        restartLabel={t('createFlow.execution.retrain')}
        stopLabel={t('createFlow.execution.stop')}
        onRebuild={() => flow.startTraining()}
        onCancel={() => void flow.cancelTraining()}
        onCompleted={(status) => void flow.refreshJob(status)}
        buildDisabled={flow.transitionState !== 'idle' || Boolean(active)}
      />

      <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => void flow.goToStep(2)}>
          {t('createFlow.actions.back')}
        </Button>
        <Button icon={<Check className="h-4 w-4" />} onClick={() => flow.finishTraining()}>
          {t('createFlow.actions.finish')}
        </Button>
      </div>
    </div>
  );
}
