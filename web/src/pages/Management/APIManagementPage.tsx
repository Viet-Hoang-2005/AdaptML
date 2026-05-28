import { Plus, ServerCog } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useModelAPIs } from '../../hooks/useModelAPIs';

export default function APIManagementPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useModelAPIs();
  const models = data?.models ?? [];

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">API Management</h1>
          <p className="mt-1 text-sm text-gray-500">Manage model endpoints, metadata, and public/private access.</p>
        </div>
        <Button size="md" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/dashboard/api-management/upload')}>
          Upload model
        </Button>
      </div>

      {isLoading ? (
        <div className="min-h-80 rounded-lg border border-gray-300 bg-white" />
      ) : models.length === 0 ? (
        <div className="min-h-105 rounded-lg border border-dashed border-gray-300 bg-white px-8 py-10">
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-black">
              <ServerCog className="h-6 w-6" />
            </div>
            <h2 className="mb-3 text-2xl font-bold text-gray-900">No model APIs</h2>
            <p className="mb-6 max-w-xl text-sm leading-6 text-gray-500">
              Upload your first MLflow model package to create a prediction endpoint.
            </p>
            <Button size="md" onClick={() => navigate('/dashboard/api-management/upload')}>
              Upload model
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {models.map((model) => (
            <Link
              key={model.id}
              to={`/dashboard/api-management/${model.id}`}
              className="rounded-lg border border-gray-300 bg-white p-5 transition-colors hover:border-black"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-400">Model API</p>
                  <h2 className="mt-2 text-lg font-bold text-gray-900">{model.name}</h2>
                </div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold capitalize text-gray-700">
                  {model.access_mode}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-gray-500">
                {model.description || 'No description provided.'}
              </p>
              <code className="mt-4 block truncate rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                {model.endpoint_url}
              </code>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
