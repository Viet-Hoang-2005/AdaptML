import { useState } from "react";
import { AlertTriangle, GitCompare, X } from "lucide-react";
import { Button } from "@/shared/components/Button";
import type {
  RegistryFamily,
  RegistryVersion,
  RegistryVersionCompareResponse,
} from "@/features/registry/types";
import { compareRegistryVersions } from "@/features/registry/api/registryApi";
import { getApiErrorMessage } from "@/shared/api/errors";
import { formatVersion } from "@/shared/lib/formatters";
import { toast } from "@/shared/components/toastStore";

interface Props {
  family: RegistryFamily;
  versions: RegistryVersion[];
  onClose: () => void;
}

const classNames = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(" ");

function formatValue(value: unknown): string {
  if (typeof value === "number")
    return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    const compact = JSON.stringify(value);
    return compact.length > 96 ? `${compact.slice(0, 95)}…` : compact;
  }
  const text = String(value);
  return text.length > 96 ? `${text.slice(0, 95)}…` : text;
}

function formatDelta(value: number | null): string {
  if (value === null || value === undefined) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(4)}`;
}

function winnerClass(winner: string) {
  if (winner === "right") return "text-blue-700 bg-blue-50 border-blue-200";
  if (winner === "left")
    return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (winner === "tie") return "text-foreground bg-muted border-border";
  return "text-muted-foreground bg-muted border-border";
}

function DeployabilityPill({ status }: { status?: string }) {
  const cls =
    status === "deployable"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : status === "track_only"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : status === "invalid"
          ? "bg-red-100 text-red-800 border-red-200"
          : "bg-muted text-foreground border-border";
  return (
    <span
      className={classNames(
        "rounded-full border px-2 py-0.5 text-xs font-bold uppercase",
        cls,
      )}
    >
      {status || "unknown"}
    </span>
  );
}

export function VersionComparisonModal({ family, versions, onClose }: Props) {
  const [leftId, setLeftId] = useState<string>(versions[0]?.id ?? "");
  const [rightId, setRightId] = useState<string>(
    versions[1]?.id || versions[0]?.id || "",
  );
  const [loading, setLoading] = useState(false);
  const [comparison, setComparison] =
    useState<RegistryVersionCompareResponse | null>(null);

  const runCompare = async () => {
    if (!leftId || !rightId || leftId === rightId) {
      toast.error("Choose two different versions to compare.");
      return;
    }
    setLoading(true);
    try {
      const data = await compareRegistryVersions(family.id, leftId, rightId);
      setComparison(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to compare versions."));
    } finally {
      setLoading(false);
    }
  };

  if (versions.length < 2) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
        <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-center p-8">
          <div className="mx-auto bg-muted rounded-full w-16 h-16 flex items-center justify-center mb-4">
            <GitCompare className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold text-foreground mb-2">
            Not Enough Versions
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            Add another version to compare model evolution.
          </p>
          <Button
            variant="primary"
            onClick={onClose}
            className="w-full justify-center"
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 text-blue-600 p-2 rounded-xl">
              <GitCompare className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">
                Compare Versions
              </h2>
              <p className="text-sm text-muted-foreground">
                Family: {family.display_name || family.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-muted-foreground transition-colors p-2 rounded-full hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-muted/50">
          <div className="grid md:grid-cols-[1fr_1fr_auto] gap-4 mb-6 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <select
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500"
              value={leftId}
              onChange={(event) => setLeftId(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  Left: {formatVersion(version.version)}{" "}
                  {version.stage === "production" ? "(Production)" : ""}
                </option>
              ))}
            </select>
            <select
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500"
              value={rightId}
              onChange={(event) => setRightId(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  Right: {formatVersion(version.version)}{" "}
                  {version.stage === "production" ? "(Production)" : ""}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              onClick={() => void runCompare()}
              disabled={loading}
            >
              {loading ? "Comparing..." : "Compare"}
            </Button>
          </div>

          <p className="mb-6 text-sm text-muted-foreground">
            Compare uses captured training summaries and artifact manifests from
            Model Evolution. MLflow is used only as internal tracking when
            available.
          </p>

          {comparison ? (
            <div className="space-y-6">
              <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      Recommendation
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {comparison.recommendation.reason}
                    </p>
                  </div>
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-bold uppercase text-foreground">
                    Winner: {comparison.recommendation.winner} ·{" "}
                    {comparison.recommendation.confidence}
                  </span>
                </div>
                {comparison.recommendation.warnings.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {comparison.recommendation.warnings.map((warning) => (
                      <div
                        key={warning}
                        className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="grid md:grid-cols-2 gap-4">
                {[comparison.left, comparison.right].map((version, index) => (
                  <div
                    key={version.id}
                    className="rounded-xl border border-border bg-surface p-5 shadow-sm"
                  >
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {index === 0 ? "Left" : "Right"}
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-foreground">
                      {formatVersion(version.version)}
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase text-foreground">
                        {version.stage}
                      </span>
                      <DeployabilityPill
                        status={version.deployability_status}
                      />
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold uppercase text-blue-700">
                        {version.tracking_status || "not synced"}
                      </span>
                    </div>
                  </div>
                ))}
              </section>

              <section className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
                <div className="border-b border-border px-5 py-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                    Metrics Diff
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">Metric</th>
                        <th className="px-4 py-2 text-right">Left</th>
                        <th className="px-4 py-2 text-right">Right</th>
                        <th className="px-4 py-2 text-right">Delta</th>
                        <th className="px-4 py-2 text-left">Winner</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {comparison.metrics_diff.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-6 text-center text-muted-foreground"
                          >
                            No metrics captured for these versions.
                          </td>
                        </tr>
                      ) : (
                        comparison.metrics_diff.map((metric) => (
                          <tr key={metric.name}>
                            <td className="px-4 py-2 font-semibold text-foreground">
                              {metric.name}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatValue(metric.left)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatValue(metric.right)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatDelta(metric.delta)}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={classNames(
                                  "rounded-full border px-2 py-0.5 text-xs font-bold uppercase",
                                  winnerClass(metric.winner),
                                )}
                              >
                                {metric.winner}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid xl:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
                  <div className="border-b border-border px-5 py-3">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                      Params Diff
                    </h3>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="min-w-full text-sm">
                      <tbody className="divide-y divide-border">
                        {comparison.params_diff.length === 0 ? (
                          <tr>
                            <td className="px-4 py-6 text-center text-muted-foreground">
                              No params captured.
                            </td>
                          </tr>
                        ) : (
                          comparison.params_diff.map((param) => (
                            <tr
                              key={param.name}
                              className={param.changed ? "bg-amber-50/40" : ""}
                            >
                              <td className="px-4 py-2 font-semibold text-foreground">
                                {param.name}
                              </td>
                              <td className="px-4 py-2 font-mono text-muted-foreground">
                                {formatValue(param.left)}
                              </td>
                              <td className="px-4 py-2 font-mono text-foreground">
                                {formatValue(param.right)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                    Deployability / Deployment
                  </h3>
                  <div className="mt-4 grid gap-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-muted-foreground">
                        Left
                      </span>
                      <DeployabilityPill
                        status={comparison.deployability_diff.left.status}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {comparison.deployability_diff.left.reason || "-"}
                    </p>
                    <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                      <span className="font-medium text-muted-foreground">
                        Right
                      </span>
                      <DeployabilityPill
                        status={comparison.deployability_diff.right.status}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {comparison.deployability_diff.right.reason || "-"}
                    </p>
                    <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                      <p>
                        Left stage:{" "}
                        <strong>{comparison.deployment_diff.left_stage}</strong>{" "}
                        · deployed:{" "}
                        <strong>
                          {comparison.deployment_diff.left_deployed
                            ? "yes"
                            : "no"}
                        </strong>
                      </p>
                      <p>
                        Right stage:{" "}
                        <strong>
                          {comparison.deployment_diff.right_stage}
                        </strong>{" "}
                        · deployed:{" "}
                        <strong>
                          {comparison.deployment_diff.right_deployed
                            ? "yes"
                            : "no"}
                        </strong>
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Artifacts / Weights Diff
                </h3>
                <div className="mt-4 grid md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                    <strong>{comparison.artifact_diff.added.length}</strong>
                    <br />
                    Added
                  </div>
                  <div className="rounded-xl bg-red-50 border border-red-100 p-3">
                    <strong>{comparison.artifact_diff.removed.length}</strong>
                    <br />
                    Removed
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <strong>{comparison.artifact_diff.changed.length}</strong>
                    <br />
                    Changed
                  </div>
                  <div className="rounded-xl bg-muted border border-border p-3">
                    <strong>{comparison.artifact_diff.unchanged_count}</strong>
                    <br />
                    Unchanged
                  </div>
                </div>
                <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-border">
                  <table className="min-w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {comparison.artifact_diff.added.map((item) => (
                        <tr key={`added-${item.path}`}>
                          <td className="px-3 py-2 font-bold text-emerald-700">
                            Added
                          </td>
                          <td className="px-3 py-2 font-mono">{item.path}</td>
                          <td className="px-3 py-2">{item.kind}</td>
                        </tr>
                      ))}
                      {comparison.artifact_diff.removed.map((item) => (
                        <tr key={`removed-${item.path}`}>
                          <td className="px-3 py-2 font-bold text-red-700">
                            Removed
                          </td>
                          <td className="px-3 py-2 font-mono">{item.path}</td>
                          <td className="px-3 py-2">{item.kind}</td>
                        </tr>
                      ))}
                      {comparison.artifact_diff.changed.map((item) => (
                        <tr key={`changed-${item.path}`}>
                          <td className="px-3 py-2 font-bold text-amber-700">
                            Changed
                          </td>
                          <td className="px-3 py-2 font-mono">{item.path}</td>
                          <td className="px-3 py-2">
                            {item.left_sha256?.slice(0, 8)} {"->"}{" "}
                            {item.right_sha256?.slice(0, 8)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-muted-foreground">
              Choose two versions and run compare.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-muted flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
