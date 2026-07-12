import type { ModelProject } from '../../../types/models';
import { PackagePreview } from '../../../components/ui/PackagePreview';

interface ModelDeploymentPageProps {
  model: ModelProject;
  zipFile: string;
}

export function ModelDeploymentPage({ model, zipFile }: ModelDeploymentPageProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold text-gray-500">Flavor</p>
          <p className="mt-1 text-base text-gray-900 capitalize">{model.flavor || '-'}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-500">Package File</p>
          <p className="mt-1 text-base text-gray-900 break-all">{zipFile}</p>
        </div>
        {model.package_preview_tree?.length ? (
          <div className="md:col-span-2">
            <p className="text-sm font-semibold text-gray-500 mb-2">Package Preview</p>
            <PackagePreview preview={model.package_preview_tree} compact />
          </div>
        ) : null}
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-gray-500">Requirements.txt</p>
          <pre className="mt-2 bg-gray-50 p-4 rounded-lg text-sm text-gray-700 whitespace-pre-wrap font-mono border border-gray-200 overflow-x-auto max-h-60">
            {model.requirements_text || '-'}
          </pre>
        </div>
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-gray-500">Model API Endpoint</p>
          <code className="mt-2 block bg-gray-50 p-4 rounded-lg text-sm text-gray-700 font-mono break-all border border-gray-200">
            {model.endpoint_url || '-'}
          </code>
        </div>
      </div>
    </div>
  );
}
