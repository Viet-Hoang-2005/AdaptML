import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BuildInputFields } from '@/features/build-deploy/components/BuildInputFields';
import { useUploadModel } from '@/features/build-deploy/uploadModelContext';
import { Button } from '@/shared/ui/Button';
import { TerminalViewer } from '@/shared/ui/TerminalViewer';

export default function BuildModelPage() {
  const { t } = useTranslation('buildDeploy');
  const {
    project,
    buildForm,
    build,
    transitionState,
    setBuildField,
    startBuild,
    continueFromBuild,
    goToStep,
    refreshBuild,
  } = useUploadModel();

  return (
    <div className="rounded-lg border border-border bg-surface p-6 lg:p-8">
      <BuildInputFields form={buildForm} setField={setBuildField} />
      <div className="mt-8 border-t border-border pt-8">
        <TerminalViewer
          key={build?.id ?? 'new-build'}
          modelId={project?.id}
          buildId={build?.id}
          title={t('uploadFlow.build.console')}
          placeholder={t('uploadFlow.build.consolePlaceholder')}
          buildDisabled={transitionState !== 'idle' || !buildForm.source_artifact}
          onRebuild={startBuild}
          onCancel={async () => {
            if (!build) return;
            const { cancelBuildById } = await import('@/features/build-deploy/api/buildDeployApi');
            await cancelBuildById(build.id);
            await refreshBuild();
          }}
          onCompleted={() => void refreshBuild()}
        />
      </div>
      <footer className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <Button variant="secondary" size="md" icon={<ArrowLeft className="h-4 w-4" />} disabled={transitionState !== 'idle'} onClick={() => void goToStep(1)}>
          {t('uploadFlow.actions.back')}
        </Button>
        <Button size="md" disabled={transitionState !== 'idle'} onClick={continueFromBuild}>
          {t('uploadFlow.actions.continue')} <ArrowRight className="h-4 w-4" />
        </Button>
      </footer>
    </div>
  );
}
