import { Clipboard, Edit3, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useDeveloperSettings } from '../../hooks/useDeveloperSettings';
import SettingsModal from './SettingsModal';

export default function DeveloperSettingPage() {
  const {
    apiKeys,
    loading,
    saving,
    modalMode,
    apiKeyName,
    apiKeyDescription,
    createdApiKey,
    setApiKeyName,
    setApiKeyDescription,
    setCreatedApiKey,
    openCreateModal,
    openEditModal,
    closeEditModal,
    handleSaveAPIKey,
    handleDeleteAPIKey,
    handleRegenerateAPIKey,
    handleCopyCreatedKey,
  } = useDeveloperSettings();

  return (
    <div className="w-full space-y-6">
      <section className="min-h-140 rounded-lg border border-gray-300 bg-white">
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
            onClick={openCreateModal}
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
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <IconButton label="Edit API key" onClick={() => openEditModal(apiKey)}>
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

      {modalMode && (
        <SettingsModal title={modalMode === 'create' ? 'Create API Key' : 'Edit API Key'} onClose={closeEditModal}>
          <p className="mb-4 text-sm text-gray-500">
            Later, API keys will be limited to selected private models during creation.
          </p>
          <div className="space-y-4">
            <Input
              id="input-api-key-name"
              label="API Name"
              placeholder="e.g. Production Inference Client"
              value={apiKeyName}
              onChange={(event) => setApiKeyName(event.target.value)}
            />
            <label htmlFor="input-api-key-description" className="flex flex-col gap-2 text-sm font-medium text-gray-700">
              Description
              <textarea
                id="input-api-key-description"
                className="min-h-24 w-full resize-none rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors duration-200 placeholder:text-gray-400 hover:border-black focus:border-black"
                placeholder="What will this API key be used for?"
                value={apiKeyDescription}
                onChange={(event) => setApiKeyDescription(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={closeEditModal}>Cancel</Button>
            <Button loading={saving} onClick={handleSaveAPIKey}>
              {modalMode === 'create' ? 'Create' : 'Save changes'}
            </Button>
          </div>
        </SettingsModal>
      )}

      {createdApiKey && (
        <SettingsModal title="API Key Created" onClose={() => setCreatedApiKey(null)}>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This key is shown once. Store it now before closing this modal.
          </div>
          <div className="mt-4 rounded-lg border border-gray-300 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">API Key</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-800">
                {createdApiKey.api_key}
              </code>
              <button
                type="button"
                onClick={handleCopyCreatedKey}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 hover:text-black"
                aria-label="Copy API key"
              >
                <Clipboard className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setCreatedApiKey(null)}>Done</Button>
          </div>
        </SettingsModal>
      )}
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
