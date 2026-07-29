import { Activity, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/shared/components/Button";
import { Badge } from "@/shared/components/Badge";
import type { DriftSummary } from "@/features/registry/types";
import { useTranslation } from "react-i18next";

interface DriftSummaryCardProps {
  driftSummary?: DriftSummary;
  modelProjectId?: string;
}

const statusPresentation = (
  status: string | undefined,
  t: (key: string) => string,
) => {
  if (status === "drift_detected")
    return { label: t("driftSummary.status.detected"), variant: "danger" as const };
  if (status === "healthy")
    return { label: t("driftSummary.status.healthy"), variant: "success" as const };
  if (status === "report_unavailable")
    return {
      label: t("driftSummary.status.reportUnavailable"),
      variant: "warning" as const,
    };
  if (status === "unknown")
    return { label: t("driftSummary.status.unknown"), variant: "neutral" as const };
  return {
    label: t("driftSummary.status.notConfigured"),
    variant: "neutral" as const,
  };
};

export function DriftSummaryCard({
  driftSummary,
  modelProjectId,
}: DriftSummaryCardProps) {
  const { t } = useTranslation("registry");
  const navigate = useNavigate();
  const fallbackUrl = modelProjectId
    ? `/dashboard/drift-monitoring/${modelProjectId}`
    : "/dashboard/drift-monitoring";
  const reportPageUrl =
    driftSummary?.report_page_url || driftSummary?.reportPageUrl || fallbackUrl;
  const driftPercent =
    driftSummary?.drift_percent ?? driftSummary?.driftPercent ?? null;
  const lastCheckedAt =
    driftSummary?.last_checked_at || driftSummary?.lastCheckedAt;
  const status = driftSummary?.status || "not_configured";
  const presentation = statusPresentation(status, t);

  return (
    <section
      className="rounded-xl border border-border bg-surface p-5 shadow-(--shadow-card)"
      aria-labelledby="drift-summary-title"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <h3
          id="drift-summary-title"
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <Activity className="h-4 w-4 text-brand-accent" />
          {t("driftSummary.title")}
        </h3>
        <Badge variant={presentation.variant}>{presentation.label}</Badge>
      </header>

      {!driftSummary || status === "not_configured" ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("driftSummary.empty")}
          </p>
          <Button
            variant="outline"
            size="sm"
            icon={<ExternalLink className="h-4 w-4" />}
            onClick={() => navigate(reportPageUrl)}
          >
            {t("driftSummary.openMonitoring")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {driftPercent !== null && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("driftSummary.latestDrift")}
              </p>
              <p
                className={
                  status === "drift_detected"
                    ? "mt-1 text-2xl font-bold text-danger"
                    : "mt-1 text-2xl font-bold text-success"
                }
              >
                {driftPercent}%
              </p>
              {driftSummary.drifted_features_count !== null &&
              driftSummary.total_features ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("driftSummary.featuresDrifted", {
                    drifted: driftSummary.drifted_features_count,
                    total: driftSummary.total_features,
                  })}
                </p>
              ) : null}
            </div>
          )}
          {lastCheckedAt && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("driftSummary.lastChecked")}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {new Date(lastCheckedAt).toLocaleString()}
              </p>
            </div>
          )}
          {driftSummary.message && (
            <p className="text-sm leading-6 text-muted-foreground sm:col-span-2">
              {driftSummary.message}
            </p>
          )}
          {status !== "report_unavailable" && (
            <Button
              className="w-fit sm:col-span-2"
              variant="outline"
              size="sm"
              icon={<ExternalLink className="h-4 w-4" />}
              onClick={() => navigate(reportPageUrl)}
            >
              {t("driftSummary.viewReport")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
