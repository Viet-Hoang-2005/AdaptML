import type { ModelProject } from "@/features/catalog/types";
import { PackagePreview } from "@/features/deploy/components/PackagePreview";
import { Link } from "react-router-dom";
import { Rocket } from "lucide-react";
import { Button } from "@/shared/components/Button";

interface ModelDeploymentPageProps {
  model: ModelProject;
  zipFile: string;
}

export function ModelDeploymentPage({
  model,
  zipFile,
}: ModelDeploymentPageProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">
            Build from current metadata
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit metadata without changing the current image, then build a new
            version when ready.
          </p>
        </div>
        <Link
          to={`/dashboard/management/model/upload/build?modelId=${model.id}`}
        >
          <Button size="md" icon={<Rocket className="h-4 w-4" />}>
            Build a new version
          </Button>
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Flavor</p>
          <p className="mt-1 text-base text-foreground capitalize">
            {model.flavor || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground">
            Package File
          </p>
          <p className="mt-1 text-base text-foreground break-all">{zipFile}</p>
        </div>
        {model.package_preview_tree?.length ? (
          <div className="md:col-span-2">
            <p className="text-sm font-semibold text-muted-foreground mb-2">
              Package Preview
            </p>
            <PackagePreview preview={model.package_preview_tree} compact />
          </div>
        ) : null}
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-muted-foreground">
            Model API Endpoint
          </p>
          <code className="mt-2 block bg-muted p-4 rounded-xl text-sm text-foreground font-mono break-all border border-border">
            {model.endpoint_url || "-"}
          </code>
        </div>
      </div>
    </div>
  );
}
