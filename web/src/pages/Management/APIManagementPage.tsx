import { Plus, Bot } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import Placeholder from '../../components/layout/Placeholder';
import { useModelAPIs } from '../../hooks/useModelAPIs';

export default function APIManagementPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useModelAPIs();
  const models = data?.models ?? [];

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">API Management</h1>
        </div>
        <Button
          size="md"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => navigate('/dashboard/api-management/upload')}
          className="px-4"
        >
          Upload model
        </Button>
      </div>

      {isLoading ? (
        <div className="flex-1 rounded-lg border border-gray-300 bg-white" />
      ) : models.length === 0 ? (
        <Placeholder
          title="No model APIs"
          description="Upload your first MLflow model package to create a prediction endpoint."
          icon={<Bot className="h-6 w-6" />}
          showModelName={false}
          action={<Button size="md" onClick={() => navigate('/dashboard/api-management/upload')}>Upload model</Button>}
        />
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
