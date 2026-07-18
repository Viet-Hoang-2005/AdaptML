import { useEffect, useRef } from "react";
import { Clipboard, Download, FileArchive, Rocket } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useTrainingJobDetailContext } from "@/features/training/trainingJobDetailContext";
import { useRuntimeLogStream } from "@/shared/hooks/useRuntimeLogStream";
import { Button } from "@/shared/ui/Button";
import { TerminalViewer } from "@/shared/ui/TerminalViewer";

const BUILD_TERMINAL_STATUSES = ["ready", "failed", "cancelled"] as const;

export default function TrainingJobArtifactsPage() {
  const { t } = useTranslation("training");
  const navigate = useNavigate();
  const {
    job,
    downloadingOutput,
    downloadOutput,
    buildingAndRegistering,
    buildAndRegister,
    requestDeleteOutputs,
    copyUri,
    refreshJob,
  } = useTrainingJobDetailContext();
  const buildActive = ["pending", "queued", "building"].includes(
    job.registration_build?.status || "",
  );

  return (
    <div className="animate-in space-y-6 fade-in duration-300">
      <div className="rounded-xl border border-primary/20 bg-primary-subtle p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-primary">
              {t("detail.registry.title")}
            </p>
            <p className="mt-1 text-sm text-primary">
              {t("detail.registry.description")}
            </p>
          </div>
          {job.registration_build?.status === "ready" ? (
            <Button
              icon={<Rocket className="h-4 w-4" />}
              onClick={() =>
                navigate(`/dashboard/model-evolution/${job.project_id}`)
              }
            >
              {t("detail.registry.open")}
            </Button>
          ) : (
            <Button
              icon={<Rocket className="h-4 w-4" />}
              loading={buildingAndRegistering}
              disabled={
                job.status !== "completed" ||
                !job.output_available ||
                buildActive
              }
              onClick={buildAndRegister}
            >
              {buildActive
                ? t("detail.registry.building")
                : job.registration_build
                  ? t("detail.registry.retry")
                  : t("detail.registry.build")}
            </Button>
          )}
        </div>
        {job.registration_build && (
          <div className="mt-5">
            <RegistrationBuildTerminal
              buildId={job.registration_build.id}
              title={t("detail.registry.console")}
              onCompleted={() => void refreshJob()}
            />
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/50 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Output Artifacts
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Download className="h-4 w-4" />}
              disabled={!job.output_available}
              loading={downloadingOutput}
              onClick={downloadOutput}
            >
              Download Model
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!job.output_available}
              onClick={requestDeleteOutputs}
            >
              {t("detail.deleteOutput")}
            </Button>
          </div>
        </div>
        <div className="space-y-6 p-6">
          {job.output_available ? (
            <>
              <ArtifactUri
                heading="Model Artifact URI"
                label="Model URI"
                value={job.model_artifact_uri}
                onCopy={copyUri}
              />
              <ArtifactUri
                heading="Output S3 URI"
                label="Output URI"
                value={job.output_s3_uri}
                onCopy={copyUri}
              />
            </>
          ) : (
            <div className="py-10 text-center">
              <FileArchive className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <p className="text-base font-bold text-muted-foreground">
                Model artifact is not ready yet.
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Artifacts will be available for download and URI inspection
                once the training completes successfully.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border bg-muted/50 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Source Files
          </h3>
        </div>
        <div className="space-y-6 p-6">
          <ArtifactUri
            heading="Source ZIP URI"
            label="Source ZIP"
            value={job.s3_source_uri}
            onCopy={copyUri}
          />
          {job.s3_training_data_uri && (
            <ArtifactUri
              heading="Training Data URI"
              label="Data URI"
              value={job.s3_training_data_uri}
              onCopy={copyUri}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RegistrationBuildTerminal({
  buildId,
  title,
  onCompleted,
}: {
  buildId: string;
  title: string;
  onCompleted: () => void;
}) {
  const handledStatus = useRef<string | null>(null);
  const stream = useRuntimeLogStream({
    source: { kind: "build", id: buildId },
    terminalStatuses: BUILD_TERMINAL_STATUSES,
  });

  useEffect(() => {
    if (
      stream.status &&
      BUILD_TERMINAL_STATUSES.includes(
        stream.status as (typeof BUILD_TERMINAL_STATUSES)[number],
      ) &&
      handledStatus.current !== stream.status
    ) {
      handledStatus.current = stream.status;
      onCompleted();
    }
  }, [onCompleted, stream.status]);

  return (
    <TerminalViewer
      title={title}
      logs={
        stream.error ? [...stream.logs, `Error: ${stream.error}`] : stream.logs
      }
    />
  );
}

function ArtifactUri({
  heading,
  label,
  value,
  onCopy,
}: {
  heading: string;
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {heading}
      </p>
      <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-2 shadow-sm">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <code
            className="mt-1 block max-w-50 truncate font-mono text-xs font-semibold text-foreground sm:max-w-md sm:text-sm lg:max-w-xl"
            title={value || "-"}
          >
            {value || "-"}
          </code>
        </div>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-surface text-muted-foreground shadow-sm transition-all hover:bg-muted hover:text-foreground disabled:opacity-40"
          disabled={!value}
          onClick={() => onCopy(value)}
          aria-label={`Copy ${label}`}
        >
          <Clipboard className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
