import type { ReactNode } from "react";
import { Activity, Cpu, HardDrive, RefreshCw, Rocket } from "lucide-react";

import { useTrainingJobDetailContext } from "@/features/training/trainingJobDetailContext";

const formatMetricPercent = (value: number) => `${Math.round(value)}%`;
const formatMegabytes = (megabytes: number) =>
  megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${Math.round(megabytes)} MB`;

export default function TrainingJobMetricsPage() {
  const {
    job,
    activeStatuses,
    metrics,
    loadingMetrics,
    refreshingSection,
    refreshMetrics,
  } = useTrainingJobDetailContext();

  if (!metrics?.metrics_available && activeStatuses.includes(job.status)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted px-4 py-16 text-center shadow-sm">
        <Activity className="mb-4 h-10 w-10 text-muted-foreground" />
        <p className="text-base font-bold text-foreground">
          Metrics are starting up
        </p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Runtime metrics will appear here automatically once the runner emits
          them.
        </p>
      </div>
    );
  }

  if (!metrics?.metrics_available) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface px-4 py-16 text-center shadow-sm">
        <Activity className="mb-4 h-10 w-10 text-muted-foreground" />
        <p className="text-base font-bold text-foreground">
          No metrics available
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          This job did not emit any runtime metrics.
        </p>
      </div>
    );
  }

  const latest = metrics.latest;
  const highCpu = latest?.cpu_percent != null && latest.cpu_percent > 85;
  const highRam =
    latest?.memory_percent != null && latest.memory_percent > 85;
  const memoryValue =
    latest?.memory_percent != null
      ? formatMetricPercent(latest.memory_percent)
      : latest?.memory_used_mb != null
        ? `${formatMegabytes(latest.memory_used_mb)} used`
        : "-";
  const memoryDetail =
    latest?.memory_used_mb != null && latest?.memory_limit_mb != null
      ? `${formatMegabytes(latest.memory_used_mb)} / ${formatMegabytes(
          latest.memory_limit_mb,
        )}`
      : latest?.memory_used_mb != null
        ? `${formatMegabytes(latest.memory_used_mb)} used`
        : metrics.message || "Waiting for runner metrics";
  const gpuValue =
    latest?.gpu_available && latest.gpu_percent != null
      ? formatMetricPercent(latest.gpu_percent)
      : "N/A";
  const gpuDetail =
    latest?.gpu_available &&
    latest.gpu_memory_used_mb != null &&
    latest.gpu_memory_total_mb != null
      ? `${formatMegabytes(latest.gpu_memory_used_mb)} / ${formatMegabytes(
          latest.gpu_memory_total_mb,
        )}`
      : "No GPU detected by runner";
  const refreshing = loadingMetrics || refreshingSection === "metrics";

  return (
    <div className="animate-in space-y-4 fade-in duration-300">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <Activity className="h-4 w-4 text-blue-500" />
            Runtime metrics
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-muted-foreground">
              {latest?.timestamp
                ? `Sampled ${new Date(latest.timestamp).toLocaleTimeString()}`
                : "Pending metrics..."}
            </span>
            <button
              type="button"
              onClick={() => void refreshMetrics()}
              disabled={refreshing}
              className="flex h-7 items-center gap-1.5 rounded border border-border bg-muted px-2.5 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCell
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="CPU"
            value={
              latest?.cpu_percent == null
                ? "-"
                : formatMetricPercent(latest.cpu_percent)
            }
            detail={
              latest?.cpu_limit_cores
                ? `${latest.cpu_limit_cores} vCPU limit`
                : "Container CPU usage"
            }
            warning={highCpu}
            progress={latest?.cpu_percent}
            progressColor={highCpu ? "bg-amber-500" : "bg-emerald-500"}
          />
          <MetricCell
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label="RAM"
            value={memoryValue}
            detail={memoryDetail}
            warning={highRam}
            progress={latest?.memory_percent}
            progressColor={highRam ? "bg-red-500" : "bg-blue-500"}
          />
          <MetricCell
            icon={<Rocket className="h-3.5 w-3.5" />}
            label="GPU"
            value={gpuValue}
            detail={gpuDetail}
            muted={!latest?.gpu_available}
            progress={latest?.gpu_percent}
            progressColor="bg-purple-500"
          />
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  icon,
  label,
  value,
  detail,
  muted = false,
  warning = false,
  progress,
  progressColor,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  muted?: boolean;
  warning?: boolean;
  progress?: number | null;
  progressColor?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-between rounded-xl border bg-muted px-5 py-4 ${
        warning ? "border-amber-300 ring-1 ring-amber-100" : "border-border"
      } ${muted ? "border-dashed opacity-50 grayscale" : ""}`}
    >
      <div>
        <div className="flex items-start justify-between">
          <p
            className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
              warning ? "text-amber-600" : "text-muted-foreground"
            }`}
          >
            {icon}
            {label}
          </p>
          <p
            className={`truncate text-2xl font-black tracking-tight ${
              warning
                ? "text-amber-700"
                : muted
                  ? "text-muted-foreground"
                  : "text-foreground"
            }`}
            title={value}
          >
            {value}
          </p>
        </div>
        {progress != null && !muted && (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all duration-500 ${
                progressColor || "bg-border"
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
              }}
            />
          </div>
        )}
      </div>
      <p
        className={`mt-3 truncate text-[11px] font-bold ${
          warning ? "text-amber-600/80" : "text-muted-foreground"
        }`}
        title={detail}
      >
        {detail}
      </p>
    </div>
  );
}
