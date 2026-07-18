import { AlertTriangle, RefreshCw } from "lucide-react";

import { TrainingEventHistory } from "@/features/training/components/TrainingOverviewSections";
import { useTrainingJobDetailContext } from "@/features/training/trainingJobDetailContext";
import { Button } from "@/shared/ui/Button";
import { PageContent } from "@/shared/ui/PageContent";
import { TerminalViewer } from "@/shared/ui/TerminalViewer";

export default function TrainingJobLogsPage() {
  const {
    job,
    activeStatuses,
    logsResponse,
    loadingLogs,
    eventsResponse,
    refreshingSection,
    refreshLogs,
  } = useTrainingJobDetailContext();

  return (
    <div className="animate-in space-y-4 fade-in duration-300">
      {job.status === "failed" && job.stop_reason && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger-subtle p-4 text-sm font-medium text-danger">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            <p className="mb-1 font-bold text-danger">Stop Reason</p>
            <p>{job.stop_reason}</p>
          </div>
        </div>
      )}
      <TerminalViewer
        title="Training output"
        bodyClassName="min-h-100 max-h-150"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshLogs()}
            disabled={loadingLogs || refreshingSection === "logs"}
            icon={
              <RefreshCw
                className={`h-3 w-3 ${
                  loadingLogs || refreshingSection === "logs"
                    ? "animate-spin"
                    : ""
                }`}
              />
            }
          >
            Refresh
          </Button>
        }
        logs={
          logsResponse?.text
            ? logsResponse.text.split("\n")
            : activeStatuses.includes(job.status)
              ? ["Logs will appear after the training container starts..."]
              : ["No logs available for this job."]
        }
      />

      <PageContent title="Event History" className="mt-8">
        <div className="p-6">
          <TrainingEventHistory events={eventsResponse?.events || []} />
        </div>
      </PageContent>
    </div>
  );
}
