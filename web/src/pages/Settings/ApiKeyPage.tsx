import { Clipboard, ArrowLeft } from 'lucide-react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useApiKeyForm } from '../../hooks/useApiKeyForm';
import { useDeveloperSettings } from '../../hooks/useDeveloperSettings';
import { useModelAPIs } from '../../hooks/useModelAPIs';
import SettingsModal from './SettingsModal';
import { toast } from '../../lib/toast';

export default function ApiKeyPage() {
  const { keyId } = useParams<{ keyId?: string }>();
  const navigate = useNavigate();
  const { apiKeys } = useDeveloperSettings();
  
  const editingKey = useMemo(() => {
    if (!keyId) return null;
    return apiKeys.find((k) => k.id === parseInt(keyId, 10)) || null;
  }, [keyId, apiKeys]);

  const {
    apiKeyName,
    setApiKeyName,
    apiKeyDescription,
    setApiKeyDescription,
    apiKeyScope,
    setApiKeyScope,
    apiKeyModels,
    setApiKeyModels,
    createdApiKey,
    setCreatedApiKey,
    handleSaveAPIKey,
    saving,
  } = useApiKeyForm(editingKey);

  const { data: modelsData } = useModelAPIs();
  const availableModels = modelsData?.models || [];

  const handleCopyCreatedKey = async () => {
    if (!createdApiKey?.api_key) return;
    try {
      await navigator.clipboard.writeText(createdApiKey.api_key);
      toast.success('API key copied to clipboard.');
    } catch {
      toast.warning('Unable to copy API key automatically.');
    }
  };

  const handleDone = () => {
    setCreatedApiKey(null);
    navigate('/dashboard/settings/developer');
  };

  return (
    <div className="flex w-full flex-col">
      <div className="flex flex-col gap-2 border-b border-gray-200 mb-4">
        <Link
          to="/dashboard/settings/developer"
          className="flex w-max items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Developer Settings
        </Link>
        <div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">
            {keyId ? 'Edit API Key' : 'Create API Key'}
          </h1>
        </div>
      </div>

      <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 space-y-6 shadow-sm">
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
          <div className="flex flex-col gap-2 pt-2">
            <span className="text-sm font-medium text-gray-700">API Key Scope</span>
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" className="h-4 w-4 text-blue-600 focus:ring-blue-500" value="all" checked={apiKeyScope === 'all'} onChange={(e) => setApiKeyScope(e.target.value)} />
                <span className="text-sm text-gray-800">All Model Endpoints</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" className="h-4 w-4 text-blue-600 focus:ring-blue-500" value="specific" checked={apiKeyScope === 'specific'} onChange={(e) => setApiKeyScope(e.target.value)} />
                <span className="text-sm text-gray-800">Specific Model Endpoints</span>
              </label>
            </div>
          </div>

          {apiKeyScope === 'specific' && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-700">Allowed Models</span>
              <div className="max-h-60 overflow-y-auto rounded-xl border border-gray-300 p-2">
                {availableModels.length === 0 ? (
                  <p className="p-2 text-sm text-gray-500">No models available.</p>
                ) : (
                  availableModels.map((model) => (
                    <label key={model.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                      <input 
                        type="checkbox" 
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={apiKeyModels.includes(model.id)}
                        onChange={(e) => {
                          if (e.target.checked) setApiKeyModels([...apiKeyModels, model.id]);
                          else setApiKeyModels(apiKeyModels.filter(id => id !== model.id));
                        }}
                      />
                      <span className="text-sm text-gray-800">{model.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-6">
          <Button variant="secondary" onClick={() => navigate('/dashboard/settings/developer')}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSaveAPIKey}>
            {keyId ? 'Save changes' : 'Create API Key'}
          </Button>
        </div>
      </div>

      {createdApiKey && (
        <SettingsModal title="API Key Created" onClose={handleDone}>
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
            <Button onClick={handleDone}>Done</Button>
          </div>
        </SettingsModal>
      )}
    </div>
  );
}
