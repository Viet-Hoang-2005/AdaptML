import { useState } from "react";
import { Button } from "@/shared/components/Button";
import { toast } from "@/shared/components/toastStore";
import { rollbackRegistryFamily } from "@/features/registry/api/registryApi";
import type {
  RegistryFamily,
  RegistryVersion,
} from "@/features/registry/types";
import { AlertCircle, RotateCcw } from "lucide-react";
import { formatVersion } from "@/shared/lib/formatters";
import { useTranslation } from "react-i18next";

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  onClose: () => void;
  onSuccess: () => void;
}

export function RollbackVersionModal({
  family,
  version,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation("registry");

  const handleRollback = async () => {
    try {
      setLoading(true);
      await rollbackRegistryFamily(family.id, version.id);
      toast.success(
        t("rollbackDialog.success", {
          version: formatVersion(version.version),
        }),
      );
      onSuccess();
    } catch {
      toast.error(t("rollbackDialog.failed"));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-amber-100 text-amber-600 p-2.5 rounded-full">
              <RotateCcw className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t("rollbackDialog.title")}
            </h3>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-800 shadow-sm">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
            <p className="text-sm">
              {t("rollbackDialog.description")}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 text-sm bg-muted p-4 rounded-xl border border-border">
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("rollbackDialog.targetVersion")}
              </span>
              <span className="font-bold font-mono text-amber-700 bg-amber-100 px-2 rounded">
                {formatVersion(version.version)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("rollbackDialog.currentProduction")}
              </span>
              <span className="font-mono text-muted-foreground">
                {family.current_production_version
                  ? formatVersion(family.current_production_version.version)
                  : t("statuses.none", { ns: "common" })}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                {t("rollbackDialog.family")}
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
            onClick={() => void handleRollback()}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl transition-colors shadow-sm disabled:opacity-50"
          >
            {loading
              ? t("rollbackDialog.submitting")
              : t("rollbackDialog.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
