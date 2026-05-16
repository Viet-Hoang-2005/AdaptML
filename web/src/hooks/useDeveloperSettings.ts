import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAPIKey,
  deleteAPIKey,
  listAPIKeys,
  regenerateAPIKey,
  updateAPIKey,
} from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { toast } from '../lib/toast';
import type { APIKeyRecord, CreatedAPIKeyResponse } from '../types/auth';
import type { KeyModalMode } from '../types/settings';

export function useDeveloperSettings() {
  const queryClient = useQueryClient();
  const [modalMode, setModalMode] = useState<KeyModalMode | null>(null);
  const [editingKey, setEditingKey] = useState<APIKeyRecord | null>(null);
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyDescription, setApiKeyDescription] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<CreatedAPIKeyResponse | null>(null);

  const apiKeysQuery = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: listAPIKeys,
  });

  useEffect(() => {
    if (apiKeysQuery.isError) {
      toast.error('Unable to load API keys.');
    }
  }, [apiKeysQuery.isError]);

  const refreshAPIKeys = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
  };

  const createAPIKeyMutation = useMutation({
    mutationFn: createAPIKey,
    onSuccess: async (response) => {
      setCreatedApiKey(response);
      closeEditModal();
      await refreshAPIKeys();
    },
    onError: () => {
      toast.error('Unable to create API key.');
    },
  });

  const updateAPIKeyMutation = useMutation({
    mutationFn: ({ id, name, description }: { id: number; name: string; description: string }) =>
      updateAPIKey(id, { name, description }),
    onSuccess: async () => {
      toast.success('API key updated successfully.');
      closeEditModal();
      await refreshAPIKeys();
    },
    onError: () => {
      toast.error('Unable to update API key.');
    },
  });

  const deleteAPIKeyMutation = useMutation({
    mutationFn: deleteAPIKey,
    onSuccess: async () => {
      toast.success('API key deleted successfully.');
      await refreshAPIKeys();
    },
    onError: () => {
      toast.error('Unable to delete API key.');
    },
  });

  const regenerateAPIKeyMutation = useMutation({
    mutationFn: regenerateAPIKey,
    onSuccess: async (response) => {
      setCreatedApiKey(response);
      await refreshAPIKeys();
    },
    onError: () => {
      toast.error('Unable to regenerate API key.');
    },
  });

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

  const handleSaveAPIKey = () => {
    if (!apiKeyName.trim()) {
      toast.warning('Please enter an API key name.');
      return;
    }

    if (modalMode === 'create') {
      createAPIKeyMutation.mutate({
        name: apiKeyName.trim(),
        description: apiKeyDescription.trim(),
      });
    } else if (modalMode === 'edit' && editingKey) {
      updateAPIKeyMutation.mutate({
        id: editingKey.id,
        name: apiKeyName.trim(),
        description: apiKeyDescription.trim(),
      });
    }
  };

  const handleDeleteAPIKey = async (apiKey: APIKeyRecord) => {
    const confirmed = window.confirm(`Delete API key "${apiKey.name}"?`);
    if (!confirmed) return;

    deleteAPIKeyMutation.mutate(apiKey.id);
  };

  const handleRegenerateAPIKey = async (apiKey: APIKeyRecord) => {
    const confirmed = window.confirm(`Regenerate API key "${apiKey.name}"? The old key value will no longer be shown.`);
    if (!confirmed) return;

    regenerateAPIKeyMutation.mutate(apiKey.id);
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

  const saving = createAPIKeyMutation.isPending || updateAPIKeyMutation.isPending;

  return {
    apiKeys: apiKeysQuery.data?.api_keys ?? [],
    loading: apiKeysQuery.isLoading,
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
