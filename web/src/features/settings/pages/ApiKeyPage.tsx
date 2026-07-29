import { Copy } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { ApiModal } from "@/features/settings/components/ApiModal";
import { useApiKeyForm } from "@/features/settings/hooks/useApiKeyForm";
import { useDeveloperSettings } from "@/features/settings/hooks/useDeveloperSettings";
import { useModelProjects } from "@/features/catalog/hooks/useModelProjects";
import { toast } from "@/shared/components/toastStore";
import type { ColumnDef } from "@tanstack/react-table";
import type { ModelProject } from "@/features/catalog/types";
import { PageHeader } from "@/shared/components/PageHeader";
import { PageBody } from "@/shared/components/PageBody";
import { DataTable } from "@/shared/components/DataTable";
import { useTranslation } from "react-i18next";

export default function ApiKeyPage() {
  const { t } = useTranslation("settings");
  const { keyId } = useParams<{ keyId?: string }>();
  const navigate = useNavigate();
  const { apiKeys } = useDeveloperSettings();

  const editingKey = useMemo(() => {
    if (!keyId) return null;
    return apiKeys.find((key) => key.id === keyId) || null;
  }, [keyId, apiKeys]);

  const {
    apiKeyName,
    setApiKeyName,
    apiKeyDescription,
    setApiKeyDescription,
    setApiKeyScope,
    apiKeyModels,
    setApiKeyModels,
    createdApiKey,
    setCreatedApiKey,
    handleSaveAPIKey,
    saving,
  } = useApiKeyForm(editingKey);

  const { data: modelsData } = useModelProjects();

  const handleCopyCreatedKey = async () => {
    if (!createdApiKey?.api_key) return;
    try {
      await navigator.clipboard.writeText(createdApiKey.api_key);
      toast.success(t("apiKey.copied"));
    } catch {
      toast.warning(t("apiKey.copyFailed"));
    }
  };

  const handleDone = () => {
    setCreatedApiKey(null);
    navigate("/dashboard/settings/developer");
  };

  const privateModels = useMemo(() => {
    const models = modelsData?.models || [];
    return models.filter((m) => m.access_mode === "private");
  }, [modelsData?.models]);

  const columns: ColumnDef<ModelProject>[] = [
    {
      id: "selected",
      header: t("apiKey.use"),
      enableSorting: false,
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={t("apiKey.allowModel", { name: row.original.name })}
          className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          checked={apiKeyModels.includes(row.original.id)}
          onChange={(event) => {
            const nextIds = event.target.checked
              ? [...apiKeyModels, row.original.id]
              : apiKeyModels.filter((id) => id !== row.original.id);
            setApiKeyModels(nextIds);
            setApiKeyScope("specific");
          }}
        />
      ),
    },
    {
      accessorKey: "name",
      header: t("apiKey.name"),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "description",
      header: t("apiKey.description"),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.description || t("apiKey.noDescription")}
        </span>
      ),
    },
  ];

  return (
    <div className="flex w-full flex-col space-y-6">
      <PageHeader
        title={keyId ? t("apiKey.editTitle") : t("apiKey.createTitle")}
        backLink={{
          to: "/dashboard/settings/developer",
          label: t("apiKey.back"),
        }}
      />

      <PageBody className="p-6 space-y-6">
        <div className="space-y-4">
          <Input
            id="input-api-key-name"
            label={t("apiKey.apiName")}
            placeholder={t("apiKey.namePlaceholder")}
            value={apiKeyName}
            onChange={(event) => setApiKeyName(event.target.value)}
          />
          <label
            htmlFor="input-api-key-description"
            className="flex flex-col gap-2 text-sm font-medium text-foreground"
          >
            {t("apiKey.description")}
            <textarea
              id="input-api-key-description"
              className="min-h-24 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition-colors duration-200 placeholder:text-muted-foreground hover:border-primary focus:border-primary"
              placeholder={t("apiKey.descriptionPlaceholder")}
              value={apiKeyDescription}
              onChange={(event) => setApiKeyDescription(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-2 pt-2">
            <span className="text-sm font-medium text-foreground">
              {t("apiKey.scope")}
            </span>
            <div className="rounded-xl border border-border bg-surface overflow-hidden mt-1">
              <DataTable
                columns={columns}
                data={privateModels}
                getRowId={(model) => model.id}
                pageSize={5}
                emptyMessage={t("apiKey.noPrivateModels")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <span className="text-sm font-medium text-foreground">
              {t("apiKey.python")}
            </span>
            <div className="relative rounded-xl border border-border bg-gray-950 overflow-hidden">
              <pre className="p-4 text-xs font-mono text-[#d4d4d4] overflow-x-auto custom-scrollbar">
                <span className="text-[#c586c0]">import</span>{" "}
                <span className="text-[#4ec9b0]">requests</span>
                {"\n\n"}
                <span className="text-[#4fc1ff]">API_URL</span> ={" "}
                <span className="text-[#ce9178]">"your_api_endpoint_url"</span>
                {"\n"}
                <span className="text-[#4fc1ff]">API_KEY</span> ={" "}
                <span className="text-[#ce9178]">"your_api_key_here"</span>
                {"\n\n"}
                <span className="text-[#9cdcfe]">headers</span> = {"{\n"}
                {"    "}
                <span className="text-[#ce9178]">"X-API-Key"</span>:{" "}
                <span className="text-[#4fc1ff]">API_KEY</span>,{"\n"}
                {"    "}
                <span className="text-[#ce9178]">"Content-Type"</span>:{" "}
                <span className="text-[#ce9178]">"application/json"</span>
                {"\n"}
                {"}\n\n"}
                <span className="text-[#9cdcfe]">payload</span> = {"{\n"}
                {"    "}
                <span className="text-[#ce9178]">"features"</span>: {"{\n"}
                {"        "}
                <span className="text-[#ce9178]">"Src Port"</span>:{" "}
                <span className="text-[#b5cea8]">443</span>,{"\n"}
                {"        "}
                <span className="text-[#6a9955]"># Add other features...</span>
                {"\n"}
                {"    }\n"}
                {"}\n\n"}
                <span className="text-[#9cdcfe]">response</span> ={" "}
                <span className="text-[#9cdcfe]">requests</span>.
                <span className="text-[#dcdcaa]">post</span>(
                <span className="text-[#4fc1ff]">API_URL</span>,{" "}
                <span className="text-[#9cdcfe]">json</span>=
                <span className="text-[#9cdcfe]">payload</span>,{" "}
                <span className="text-[#9cdcfe]">headers</span>=
                <span className="text-[#9cdcfe]">headers</span>){"\n"}
                <span className="text-[#dcdcaa]">print</span>(
                <span className="text-[#9cdcfe]">response</span>.
                <span className="text-[#dcdcaa]">json</span>())
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `import requests\n\nAPI_URL = "http://localhost:5000/predict"\nAPI_KEY = "your_api_key_here"\n\nheaders = {\n    "X-API-Key": API_KEY,\n    "Content-Type": "application/json"\n}\n\npayload = {\n    "features": {\n        "Src Port": 443,\n        # Add other features...\n    }\n}\n\nresponse = requests.post(API_URL, json=payload, headers=headers)\nprint(response.json())`,
                  );
                  toast.success(t("apiKey.codeCopied"));
                }}
                className="absolute right-3 top-3 rounded-md bg-gray-800 p-2 text-muted-foreground shadow-sm ring-1 ring-gray-700 hover:text-white hover:bg-gray-700 transition-colors"
                title={t("apiKey.copyCode")}
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-6">
          <Button
            variant="secondary"
            onClick={() => navigate("/dashboard/settings/developer")}
          >
            {t("apiKey.cancel")}
          </Button>
          <Button loading={saving} onClick={handleSaveAPIKey}>
            {keyId ? t("apiKey.save") : t("apiKey.createTitle")}
          </Button>
        </div>
      </PageBody>

      {createdApiKey && (
        <ApiModal
          title={t("apiKey.createdTitle")}
          description={t("apiKey.createdDescription")}
          apiKey={createdApiKey.api_key}
          onClose={handleDone}
          onCopy={handleCopyCreatedKey}
        />
      )}
    </div>
  );
}
