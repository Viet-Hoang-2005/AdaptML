import { Copy, ExternalLink, UploadCloud } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Placeholder from '@/features/catalog/components/ModelPlaceholder';
import { PageContent } from '@/shared/ui/PageContent';
import { Button } from '@/shared/ui/Button';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import { toast } from '@/shared/ui/toastStore';

export default function ModelProjectPage() {
  const navigate = useNavigate();
  const { selectedModel, loading } = useModelSelection();

  const copyEndpoint = async () => {
    if (!selectedModel?.endpoint_url) return;
    await navigator.clipboard.writeText(selectedModel.endpoint_url);
    toast.success('Endpoint copied.');
  };

  if (loading) return <section className="flex-1 rounded-lg border border-gray-300 bg-white p-8" />;

  if (!selectedModel) {
    return (
      <Placeholder
        title="No model project yet"
        description="Upload a model or create a training job to start a model project."
        icon={<UploadCloud className="h-6 w-6" />}
        action={<Button size="md" onClick={() => navigate('/dashboard/api-management/upload')}>Upload model</Button>}
      />
    );
  }

  return (
    <PageContent>
      <div className="border-b border-gray-200 p-6">
        <p className="text-xs font-semibold uppercase text-gray-400">{selectedModel.status}</p>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">{selectedModel.name}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
          {selectedModel.description || 'No description provided.'}
        </p>
      </div>

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase text-gray-400">Access</p>
          <p className="mt-2 text-sm font-bold capitalize text-gray-900">{selectedModel.access_mode}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase text-gray-400">Flavor</p>
          <p className="mt-2 text-sm font-bold text-gray-900 capitalize">{selectedModel.flavor || '-'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase text-gray-400">Updated</p>
          <p className="mt-2 text-sm font-bold text-gray-900">
            {new Date(selectedModel.updated_at).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="border-t border-gray-200 p-6">
        <p className="mb-2 text-sm font-semibold text-gray-900">Prediction endpoint</p>
        <div className="flex flex-col gap-3 rounded-lg border border-gray-300 bg-gray-50 p-3 md:flex-row md:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto text-sm text-gray-700">{selectedModel.endpoint_url}</code>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyEndpoint}>
              Copy
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink className="h-4 w-4" />}
              onClick={() => navigate(`/dashboard/api-management/${selectedModel.id}`)}
            >
              Manage
            </Button>
          </div>
        </div>
      </div>
    </PageContent>
  );
}
