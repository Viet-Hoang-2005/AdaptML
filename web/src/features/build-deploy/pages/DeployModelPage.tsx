import { ArrowLeft, Check, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { BuildSummaryItem } from '@/features/build-deploy/components/BuildSummaryItem';
import { useUploadModel } from '@/features/build-deploy/uploadModelContext';
import { Button } from '@/shared/ui/Button';
import { TerminalViewer } from '@/shared/ui/TerminalViewer';

export default function DeployModelPage() {
  const { t } = useTranslation('buildDeploy');
  const navigate = useNavigate();
  const {
    project,
    build,
    deployment,
    transitionState,
    deploy,
    goToStep,
    handleDeploymentCompleted,
  } = useUploadModel();
  if (!project || !build) return null;

  const running = Boolean(deployment && ['pending', 'deploying'].includes(deployment.status));
  const success = deployment?.status === 'healthy';
  const failed = Boolean(deployment && ['failed', 'unhealthy', 'stopped'].includes(deployment.status));
  const deployStatus = !deployment ? t('uploadFlow.deploy.none') : success ? t('uploadFlow.deploy.success') : failed ? t('uploadFlow.deploy.error') : t('uploadFlow.deploy.deploying');

  return (
    <div className="rounded-lg border border-border bg-surface p-6 lg:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <BuildSummaryItem label={t('uploadFlow.deploy.model')} value={project.name} />
        <BuildSummaryItem label={t('uploadFlow.deploy.flavor')} value={build.flavor} />
        <BuildSummaryItem label={t('uploadFlow.deploy.version')} value={build.version_number ? `v${build.version_number}` : '-'} />
        <BuildSummaryItem label={t('uploadFlow.deploy.status')} value={deployStatus} />
      </div>

      <div className="mt-8">
        <TerminalViewer
          key={deployment?.id ?? 'new-deployment'}
          modelId={project.id}
          deploymentId={deployment?.id}
          title={t('uploadFlow.deploy.console')}
          placeholder={t('uploadFlow.deploy.consolePlaceholder')}
          onCompleted={handleDeploymentCompleted}
        />
      </div>

      <footer className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <Button variant="secondary" size="md" icon={<ArrowLeft className="h-4 w-4" />} disabled={transitionState !== 'idle' || running} onClick={() => void goToStep(2)}>
          {t('uploadFlow.actions.back')}
        </Button>
        <Button
          size="md"
          icon={success ? <Check className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
          disabled={running || transitionState !== 'idle'}
          loading={running || transitionState === 'starting-deployment'}
          onClick={() => success ? navigate('/dashboard/home/models') : void deploy()}
        >
          {success ? t('uploadFlow.actions.finish') : failed ? t('uploadFlow.actions.retryDeploy') : running ? t('uploadFlow.actions.deploying') : t('uploadFlow.actions.deploy')}
        </Button>
      </footer>
    </div>
  );
}
