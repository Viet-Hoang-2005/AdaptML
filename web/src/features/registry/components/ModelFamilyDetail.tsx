import type {
  RegistryFamily,
  RegistryVersion,
} from "@/features/registry/types";
import {
  Layers,
  Star,
  Info,
  FileCode2,
  Activity,
  GitCommit,
} from "lucide-react";
import { formatVersion } from "@/shared/lib/formatters";
import { useTranslation } from "react-i18next";

const classNames = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(" ");

interface Props {
  family: RegistryFamily;
  versions: RegistryVersion[];
  loading: boolean;
  selectedVersionId?: string;
  onSelectVersion: (v: RegistryVersion) => void;
}

export function ModelFamilyDetail({
  family,
  versions,
  loading,
  selectedVersionId,
  onSelectVersion,
}: Props) {
  const { t } = useTranslation("registry");
  const prodVersion = family.current_production_version;
  const isEndpointReady = prodVersion && !!prodVersion.endpoint_url;

  return (
    <div className="flex flex-col border border-border rounded-xl overflow-hidden bg-surface shadow-sm">
      {/* Hero Header */}
      <div className="bg-muted border-b border-border p-6 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <h2 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            {family.display_name || family.name}
          </h2>

          <div className="flex flex-wrap items-center gap-2 mt-1 md:mt-0">
            {prodVersion ? (
              <>
                <span className="inline-flex items-center gap-1 text-success bg-success-subtle px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                  <Star className="h-3 w-3 fill-emerald-500 text-emerald-500" />{" "}
                  {t("familyDetail.productionVersion", {
                    version: formatVersion(prodVersion.version),
                  })}
                </span>
                {isEndpointReady ? (
                  <span className="inline-flex items-center gap-1 text-success border border-success/20 bg-success-subtle px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                    <Activity className="h-3 w-3" />{" "}
                    {t("familyDetail.endpointReady")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground border border-border bg-muted px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                    {t("familyDetail.noEndpoint")}
                  </span>
                )}
                <span className="inline-flex items-center text-muted-foreground border border-border bg-surface px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                  {t("familyDetail.registryMarkerOnly")}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground bg-muted px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                {t("familyDetail.noProductionVersion")}
              </span>
            )}
          </div>
        </div>

        <div>
          {prodVersion && (
            <p className="text-sm text-foreground flex items-center gap-1.5 mb-1">
              <GitCommit className="h-4 w-4 text-muted-foreground" />
              {t("familyDetail.registeredFrom", {
                source: prodVersion.source_type.replace("_", " "),
              })}
              {prodVersion.source_training_job_id
                ? ` #${prodVersion.source_training_job_id}`
                : ""}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground font-medium">
            <span>
              {t("familyDetail.versionCount", { count: versions.length })}
            </span>
            <span>&middot;</span>
            <span>
              {t("familyDetail.updated", {
                date: new Date(family.updated_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }),
              })}
            </span>
            <span>&middot;</span>
            <span className="text-muted-foreground">
              {t("familyDetail.routingAliasDisabled")}
            </span>
          </div>
        </div>
      </div>

      {/* Version Table */}
      <div className="p-0 overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th
                scope="col"
                className="py-3 pl-5 pr-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {t("familyDetail.version")}
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {t("familyDetail.stage")}
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {t("familyDetail.source")}
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {t("familyDetail.updatedColumn")}
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {t("familyDetail.endpoint")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  <div className="flex justify-center mb-2">
                    <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  {t("familyDetail.loadingVersions")}
                </td>
              </tr>
            ) : versions.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  {t("familyDetail.noVersions")}
                </td>
              </tr>
            ) : (
              versions.map((v) => {
                const isProd = v.stage === "production";
                const isSelected = v.id === selectedVersionId;
                return (
                  <tr
                    key={v.id}
                    onClick={() => onSelectVersion(v)}
                    className={classNames(
                      "cursor-pointer transition-colors duration-150",
                      isSelected ? "bg-primary-subtle" : "hover:bg-muted",
                    )}
                  >
                    <td className="whitespace-nowrap py-4 pl-5 pr-3 text-sm font-medium text-foreground flex items-center gap-2">
                      <Layers
                        className={classNames(
                          "h-4 w-4",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="font-mono font-semibold">
                        {formatVersion(v.version)}
                      </span>
                      {isProd && (
                        <Star className="h-4 w-4 text-amber-400 fill-amber-400 ml-1" />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-muted-foreground">
                      <span
                        className={classNames(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
                          v.stage === "production"
                            ? "bg-success text-primary-foreground"
                            : v.stage === "staging"
                              ? "bg-primary-subtle text-primary"
                              : v.stage === "candidate"
                                ? "bg-warning-subtle text-warning"
                                : v.stage === "archived"
                                  ? "bg-muted text-foreground"
                                  : "bg-muted text-muted-foreground",
                        )}
                      >
                        {v.stage}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-muted-foreground flex items-center gap-1.5">
                      {v.source_type === "training_job" ? (
                        <FileCode2 className="h-4 w-4" />
                      ) : (
                        <Info className="h-4 w-4" />
                      )}
                      {v.source_type.replace("_", " ")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-muted-foreground">
                      {new Date(v.updated_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-muted-foreground">
                      {v.endpoint_url ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
                          <Activity className="h-3 w-3" />{" "}
                          {t("familyDetail.ready")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">
                          -
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
