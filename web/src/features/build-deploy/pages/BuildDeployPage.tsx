import { ArrowLeft, Check, Rocket } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  cancelBuild,
  discardBuildImageOnPageExit,
  deployBuild,
  getBuild,
  getLatestProjectBuild,
  getModelBuildMetadata,
  saveBuildImage,
  startProjectBuild,
} from '@/features/build-deploy/api/buildDeployApi';
import { BuildSummaryItem } from '@/features/build-deploy/components/BuildSummaryItem';
import type { Build, Deployment, ModelBuildMetadata } from '@/features/catalog/types';
import { getApiErrorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/PageHeader';
import { StepTitle } from '@/shared/ui/StepTitle';
import { TerminalViewer } from '@/shared/ui/TerminalViewer';
import { toast } from '@/shared/ui/toastStore';

const metadataPath = '/dashboard/management/model/upload/metadata';

export default function BuildDeployPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const modelId = searchParams.get('modelId');
  const [metadata, setMetadata] = useState<ModelBuildMetadata | null>(null);
  const [build, setBuild] = useState<Build | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const activeUnsavedBuildId = useRef<string | null>(null);
  const cleanupArmed = useRef(false);
  const cleanupSent = useRef(false);

  useEffect(() => {
    if (!modelId) {
      navigate(metadataPath, { replace: true });
      return;
    }
    Promise.all([getModelBuildMetadata(modelId), getLatestProjectBuild(modelId)])
      .then(([result, latestBuild]) => {
        setMetadata(result);
        setBuild(latestBuild);
      })
      .catch((error) => {
        toast.error(getApiErrorMessage(error, 'Unable to load build details.'));
        navigate(`${metadataPath}?modelId=${modelId}`, { replace: true });
      })
      .finally(() => setLoading(false));
  }, [modelId, navigate]);

  const buildImage = async () => {
    if (!modelId) return;
    setActionLoading(true);
    try {
      const nextBuild = await startProjectBuild(modelId);
      setBuild(nextBuild);
      setDeployment(null);
      toast.success('Image build started.');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to start the image build.'));
    } finally {
      setActionLoading(false);
    }
  };

  const saveImage = async () => {
    if (!build) return;
    setActionLoading(true);
    try {
      const savedBuild = await saveBuildImage(build.id);
      activeUnsavedBuildId.current = null;
      cleanupSent.current = true;
      setBuild(savedBuild);
      toast.success('Image saved for later deployment.');
      navigate('/dashboard/management');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to save the image.'));
    } finally {
      setActionLoading(false);
    }
  };

  const deployImage = async () => {
    if (!build) return;
    setActionLoading(true);
    try {
      const nextDeployment = await deployBuild(build.id);
      setDeployment(nextDeployment);
      setBuild((current) => current
        ? { ...current, is_saved: true, saved_at: current.saved_at ?? new Date().toISOString() }
        : current);
      toast.success('Deployment started.');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to deploy the image.'));
    } finally {
      setActionLoading(false);
    }
  };

  const refreshBuild = async () => {
    if (!build) return;
    setBuild(await getBuild(build.id));
  };

  const handleDeploymentCompleted = useCallback((status: string) => {
    if (!['healthy', 'unhealthy', 'failed', 'stopped'].includes(status)) return;
    setDeployment((current) => current
      ? { ...current, status: status as Deployment['status'] }
      : current);
  }, []);

  const readyUnsavedBuildId = build?.status === 'ready' && !build.is_saved && !deployment ? build.id : null;
  useEffect(() => {
    activeUnsavedBuildId.current = readyUnsavedBuildId;
    cleanupSent.current = false;
  }, [readyUnsavedBuildId]);

  useEffect(() => {
    const armCleanup = window.setTimeout(() => { cleanupArmed.current = true; }, 0);
    const discard = () => {
      const buildId = activeUnsavedBuildId.current;
      if (!cleanupArmed.current || !buildId || cleanupSent.current) return;
      cleanupSent.current = true;
      // Best effort only: the server-side periodic cleanup remains authoritative.
      void discardBuildImageOnPageExit(buildId);
    };
    window.addEventListener('pagehide', discard);
    return () => {
      window.clearTimeout(armCleanup);
      window.removeEventListener('pagehide', discard);
      discard();
    };
  }, []);

  if (loading) return <div className="rounded-lg border border-border bg-surface p-8 text-sm text-muted-foreground">Loading build and deployment…</div>;
  if (!modelId || !metadata) return null;

  const isReady = build?.status === 'ready';
  const isSaveable = Boolean(isReady && !build?.is_saved);
  const deploymentRunning = Boolean(deployment && ['pending', 'deploying'].includes(deployment.status));
  const deploymentFinished = deployment?.status === 'healthy';
  const metadataBackUrl = `${metadataPath}?modelId=${modelId}`;

  return (
    <section className="space-y-6">
      <PageHeader title="Create a new model" backLink={{ to: '/dashboard/management', label: 'Back to Model Managemnet' }} />
      <div className="rounded-lg border border-border bg-surface p-6 lg:p-8">
        <div className="space-y-6">
          <StepTitle
            title="Build & Deploy model"
            description="Build an image from the saved metadata revision, then save it for later or deploy it immediately."
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <BuildSummaryItem label="Model" value={metadata.name} />
            <BuildSummaryItem label="Metadata revision" value={`r${metadata.revision}`} />
            <BuildSummaryItem label="Flavor" value={metadata.flavor} />
            <BuildSummaryItem label="Image status" value={build?.status ?? 'Not built'} />
          </div>

          <TerminalViewer
            key={build?.id ?? 'idle'}
            modelId={modelId}
            buildId={build?.id}
            title="Build Console"
            placeholder="Build an image to stream package logs here."
            onRebuild={buildImage}
            onCancel={async () => {
              await cancelBuild(modelId);
              await refreshBuild();
            }}
            onBuildSuccess={() => void refreshBuild()}
          />

          {deployment ? (
            <TerminalViewer
              key={deployment.id}
              modelId={modelId}
              deploymentId={deployment.id}
              title="Deployment Console"
              onCompleted={handleDeploymentCompleted}
            />
          ) : null}
        </div>

        <footer className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
          <Button variant="secondary" size="md" icon={<ArrowLeft className="h-4 w-4" />} disabled={actionLoading} onClick={() => navigate(metadataBackUrl)}>Back</Button>
          <Button variant="secondary" size="md" disabled={!isSaveable || actionLoading} loading={actionLoading && isSaveable} onClick={() => void saveImage()}>
            {build?.is_saved ? 'Image saved' : '- Save image -'}
          </Button>
          <Button
            size="md"
            icon={deployment ? <Check className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            disabled={deployment ? !deploymentFinished : !isReady || actionLoading}
            loading={deployment ? deploymentRunning : actionLoading && isReady}
            onClick={() => deploymentFinished
              ? navigate('/dashboard/home/models')
              : void deployImage()}
          >
            {deployment ? 'Finish' : 'Deploy'}
          </Button>
        </footer>
      </div>
    </section>
  );
}
