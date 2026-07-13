import type { ModelProject } from '@/features/catalog/types';
import { PackagePreview } from '@/features/build-deploy/components/PackagePreview';

interface ModelDeploymentPageProps {
  model: ModelProject;
  zipFile: string;
}

export function ModelDeploymentPage({ model, zipFile }: ModelDeploymentPageProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Flavor</p>
          <p className="mt-1 text-base text-foreground capitalize">{model.flavor || '-'}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Package File</p>
          <p className="mt-1 text-base text-foreground break-all">{zipFile}</p>
        </div>
        {model.package_preview_tree?.length ? (
          <div className="md:col-span-2">
            <p className="text-sm font-semibold text-muted-foreground mb-2">Package Preview</p>
            <PackagePreview preview={model.package_preview_tree} compact />
          </div>
        ) : null}
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-muted-foreground">Requirements.txt</p>
          <pre className="mt-2 bg-muted p-4 rounded-lg text-sm text-foreground whitespace-pre-wrap font-mono border border-border overflow-x-auto max-h-60">
            {model.requirements_text || '-'}
          </pre>
        </div>
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-muted-foreground">Model API Endpoint</p>
          <code className="mt-2 block bg-muted p-4 rounded-lg text-sm text-foreground font-mono break-all border border-border">
            {model.endpoint_url || '-'}
          </code>
        </div>
      </div>
    </div>
  );
}
