import { useState } from "react";
import { Button } from "@/shared/components/Button";
import { toast } from "@/shared/components/toastStore";
import { promoteRegistryVersion } from "@/features/registry/api/registryApi";
import { getApiErrorMessage } from "@/shared/api/errors";
import type {
  RegistryFamily,
  RegistryVersion,
  RoutingAliasName,
} from "@/features/registry/types";
import { AlertCircle, ArrowUpCircle } from "lucide-react";
import { formatVersion } from "@/shared/lib/formatters";
import { useTranslation } from "react-i18next";

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  onClose: () => void;
  onSuccess: () => void;
}

export function PromoteVersionModal({
  family,
  version,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [alias, setAlias] = useState<RoutingAliasName>("production");
  const { t } = useTranslation("registry");

  const handlePromote = async () => {
    try {
      setLoading(true);
      const result = await promoteRegistryVersion(family.id, version.id, alias);
      toast.success(
        result.message ||
          t("promoteDialog.success", {
            version: formatVersion(version.version),
            alias,
          }),
      );
      if (result.warning) {
        toast.warning(result.warning);
      }
      onSuccess();
    } catch (error) {
      toast.error(
        getApiErrorMessage(
          error,
          t("promoteDialog.failed"),
        ),
      );
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-emerald-100 text-emerald-600 p-2.5 rounded-full">
              <ArrowUpCircle className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t("promoteDialog.title")}
            </h3>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 text-blue-800 shadow-sm">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-blue-600" />
            <p className="text-sm">
              {t("promoteDialog.description")}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 text-sm bg-muted p-4 rounded-xl border border-border">
            <label className="flex flex-col gap-2 pb-2 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("promoteDialog.alias")}
              </span>
              <select
                value={alias}
                onChange={(event) =>
                  setAlias(event.target.value as RoutingAliasName)
                }
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                disabled={loading}
              >
                <option value="production">{t("promoteDialog.production")}</option>
                <option value="latest">{t("promoteDialog.latest")}</option>
                <option value="champion">{t("promoteDialog.champion")}</option>
              </select>
            </label>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("promoteDialog.targetVersion")}
              </span>
              <span className="font-bold font-mono text-emerald-700 bg-emerald-100 px-2 rounded">
                {formatVersion(version.version)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("promoteDialog.currentProduction")}
              </span>
              <span className="font-mono text-muted-foreground">
                {family.current_production_version
                  ? formatVersion(family.current_production_version.version)
                  : t("statuses.none", { ns: "common" })}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("promoteDialog.family")}
              </span>
              <span className="font-bold text-foreground">
                {family.display_name || family.name}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted border-t border-border flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <button
            onClick={() => void handlePromote()}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors shadow-sm disabled:opacity-50"
          >
            {loading
              ? t("promoteDialog.submitting")
              : t("promoteDialog.submit", { alias })}
          </button>
        </div>
      </div>
    </div>
  );
}
