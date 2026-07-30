import type { TrainingJobEvent } from "@/features/training/types";
import { Badge } from "@/shared/components/Badge";
import { useTranslation } from "react-i18next";

export function MetadataRow({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          monospace
            ? "w-fit rounded-surface border border-border bg-muted px-2 py-1 font-mono text-sm text-foreground"
            : "text-sm font-medium text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function LiveStatusBadge() {
  const { t } = useTranslation("training");
  return (
    <Badge variant="success">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {t("runtime.livePolling")}
    </Badge>
  );
}

export function TrainingEventHistory({
  events,
}: {
  events: TrainingJobEvent[];
}) {
  const { t } = useTranslation("training");
  if (!events.length) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("runtime.eventEmpty")}
      </div>
    );
  }
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-6 text-sm">
          <time
            className="w-36 shrink-0 text-muted-foreground"
            dateTime={event.created_at}
          >
            {new Date(event.created_at).toLocaleString()}
          </time>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">
              {event.event_type.replace(/_/g, " ")}
            </p>
            <p className="wrap-break-words text-muted-foreground">
              {event.message}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
