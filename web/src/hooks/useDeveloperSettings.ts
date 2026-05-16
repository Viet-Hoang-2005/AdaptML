import { useEffect, useState } from 'react';
import {
  createAPIKey,
  deleteAPIKey,
  listAPIKeys,
  regenerateAPIKey,
  updateAPIKey,
} from '../lib/api';
import { toast } from '../lib/toast';
import type { APIKeyRecord, CreatedAPIKeyResponse } from '../types/auth';
import type { KeyModalMode } from '../types/settings';

export function useDeveloperSettings() {
  const [apiKeys, setApiKeys] = useState<APIKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalMode, setModalMode] = useState<KeyModalMode | null>(null);
  const [editingKey, setEditingKey] = useState<APIKeyRecord | null>(null);
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyDescription, setApiKeyDescription] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<CreatedAPIKeyResponse | null>(null);

  const loadAPIKeys = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const response = await listAPIKeys();
      setApiKeys(response.api_keys);
    } catch {
      toast.error('Unable to load API keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    listAPIKeys()
      .then((response) => {
        if (mounted) {
          setApiKeys(response.api_keys);
        }
      })
      .catch(() => {
        if (mounted) {
          toast.error('Unable to load API keys.');
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const openCreateModal = () => {
    setModalMode('create');
    setEditingKey(null);
    setApiKeyName('');
    setApiKeyDescription('');
  };

  const openEditModal = (apiKey: APIKeyRecord) => {
    setModalMode('edit');
    setEditingKey(apiKey);
    setApiKeyName(apiKey.name);
    setApiKeyDescription(apiKey.description);
  };

  const closeEditModal = () => {
    setModalMode(null);
    setEditingKey(null);
    setApiKeyName('');
    setApiKeyDescription('');
  };

  const handleSaveAPIKey = async () => {
    if (!apiKeyName.trim()) {
      toast.warning('Please enter an API key name.');
      return;
    }

    setSaving(true);
    try {
      if (modalMode === 'create') {
        const response = await createAPIKey({
          name: apiKeyName.trim(),
          description: apiKeyDescription.trim(),
        });
        setCreatedApiKey(response);
      } else if (modalMode === 'edit' && editingKey) {
        await updateAPIKey(editingKey.id, {
          name: apiKeyName.trim(),
          description: apiKeyDescription.trim(),
        });
        toast.success('API key updated successfully.');
      }

      closeEditModal();
      await loadAPIKeys(false);
    } catch {
      toast.error(modalMode === 'create' ? 'Unable to create API key.' : 'Unable to update API key.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAPIKey = async (apiKey: APIKeyRecord) => {
    const confirmed = window.confirm(`Delete API key "${apiKey.name}"?`);
    if (!confirmed) return;

    try {
      await deleteAPIKey(apiKey.id);
      toast.success('API key deleted successfully.');
      await loadAPIKeys(false);
    } catch {
      toast.error('Unable to delete API key.');
    }
  };

  const handleRegenerateAPIKey = async (apiKey: APIKeyRecord) => {
    const confirmed = window.confirm(`Regenerate API key "${apiKey.name}"? The old key value will no longer be shown.`);
    if (!confirmed) return;

    try {
      const response = await regenerateAPIKey(apiKey.id);
      setCreatedApiKey(response);
      await loadAPIKeys(false);
    } catch {
      toast.error('Unable to regenerate API key.');
    }
  };

  const handleCopyCreatedKey = async () => {
    if (!createdApiKey?.api_key) return;
    try {
      await navigator.clipboard.writeText(createdApiKey.api_key);
      toast.success('API key copied to clipboard.');
    } catch {
      toast.warning('Unable to copy API key automatically.');
    }
  };

  return {
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
  };
}
