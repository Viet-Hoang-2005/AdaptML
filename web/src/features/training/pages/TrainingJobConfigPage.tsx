import { MetadataRow } from "@/features/training/components/TrainingOverviewSections";
import { useTrainingJobDetailContext } from "@/features/training/trainingJobDetailContext";

export default function TrainingJobConfigPage() {
  const { job } = useTrainingJobDetailContext();

  return (
    <div className="animate-in overflow-hidden rounded-xl border border-border bg-surface shadow-sm fade-in duration-300">
      <div className="border-b border-border bg-muted/50 px-6 py-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Submitted Configuration
        </h3>
      </div>
      <div className="space-y-8 p-6">
        <div>
          <h4 className="mb-4 border-b border-border pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Compute & Runtime
          </h4>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <MetadataRow
              label="Training Backend"
              value={job.backend || "Unknown"}
            />
            <MetadataRow label="vCPU" value={String(job.vcpu)} />
            <MetadataRow label="Memory (MB)" value={String(job.memory)} />
            <MetadataRow
              label="Max Runtime (Seconds)"
              value={String(job.max_runtime_seconds)}
            />
          </div>
        </div>
        <div>
          <h4 className="mb-4 border-b border-border pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Accelerator
          </h4>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <MetadataRow
              label="Accelerator Type"
              value={
                job.accelerator_type === "none"
                  ? "None"
                  : job.accelerator_type.toUpperCase()
              }
            />
            {job.accelerator_type !== "none" && (
              <MetadataRow
                label="Accelerator Count"
                value={String(job.accelerator_count)}
              />
            )}
          </div>
        </div>
        <div>
          <h4 className="mb-4 border-b border-border pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Source
          </h4>
          <MetadataRow
            label="Entry Point"
            value={job.entry_point}
            monospace
          />
        </div>
      </div>
    </div>
  );
}
