import { Edit3, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useDeveloperSettings } from '../../hooks/useDeveloperSettings';

export default function DeveloperSettingPage() {
  const navigate = useNavigate();
  const {
    apiKeys,
    loading,
    handleDeleteAPIKey,
    handleRegenerateAPIKey,
  } = useDeveloperSettings();

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <section className="flex flex-1 flex-col rounded-lg border border-gray-300 bg-white">
        <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Developer Access</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create and manage API keys for private model endpoint authentication.
            </p>
          </div>
          <Button
            id="btn-create-api-key"
            size='md'
            icon={<KeyRound className="h-4 w-4" />}
            onClick={() => navigate('/dashboard/settings/api-keys/create')}
          >
            Create API Key
          </Button>
        </div>

        <div className="px-6 py-6">
          {loading ? (
            <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
              Loading API keys...
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
              <KeyRound className="mx-auto mb-3 h-8 w-8 text-gray-400" />
              <h3 className="text-sm font-bold text-gray-900">No API keys yet</h3>
              <p className="mt-1 text-sm text-gray-500">Create your first API key to call private model endpoints.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((apiKey) => (
                <div
                  key={apiKey.id}
                  className="flex flex-col gap-4 rounded-lg border border-gray-300 px-4 py-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-bold text-gray-900">{apiKey.name}</h3>
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-500">
                        {apiKey.key_prefix}...
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {apiKey.description || 'No description provided.'}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {apiKey.scope === 'all' ? 'All Models' : 'Specific Models'}
                      </span>
                      {apiKey.scope === 'specific' && (
                        <span className="text-xs text-gray-500">
                          {apiKey.allowed_models.length} model(s) allowed
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <IconButton label="Edit API key" onClick={() => navigate(`/dashboard/settings/api-keys/${apiKey.id}`)}>
                      <Edit3 className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Regenerate API key" onClick={() => handleRegenerateAPIKey(apiKey)}>
                      <RefreshCw className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Delete API key" danger onClick={() => handleDeleteAPIKey(apiKey)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function IconButton({
  children,
  label,
  danger = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
        danger
          ? 'border-red-100 text-red-500 hover:bg-red-50'
          : 'border-gray-300 text-gray-500 hover:border-gray-300 hover:text-black'
      }`}
    >
      {children}
    </button>
  );
}
