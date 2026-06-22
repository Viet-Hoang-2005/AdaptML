import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createAPIKey, updateAPIKey } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { queryKeys } from '../lib/queryKeys';
import { toast } from '../lib/toast';
import type { APIKeyRecord, CreatedAPIKeyResponse } from '../types/auth';

export function useApiKeyForm(initialData?: APIKeyRecord | null) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [apiKeyName, setApiKeyName] = useState(initialData?.name || '');
  const [apiKeyDescription, setApiKeyDescription] = useState(initialData?.description || '');
  const [apiKeyScope, setApiKeyScope] = useState(initialData?.scope || 'all');
  const [apiKeyModels, setApiKeyModels] = useState<number[]>(initialData?.allowed_models || []);
  const [createdApiKey, setCreatedApiKey] = useState<CreatedAPIKeyResponse | null>(null);

  const [prevInitialData, setPrevInitialData] = useState(initialData);

  if (initialData !== prevInitialData) {
    setPrevInitialData(initialData);
    if (initialData) {
      setApiKeyName(initialData.name || '');
      setApiKeyDescription(initialData.description || '');
      setApiKeyScope(initialData.scope || 'all');
      setApiKeyModels(initialData.allowed_models || []);
    }
  }

  const refreshAPIKeys = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
  };

  const createAPIKeyMutation = useMutation({
    mutationFn: createAPIKey,
    onSuccess: async (response) => {
      setCreatedApiKey(response);
      await refreshAPIKeys();
      toast.success('API key created successfully.');
      // Navigation is handled by the component after the user copies the key
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to create API key.'));
    },
  });

  const updateAPIKeyMutation = useMutation({
    mutationFn: ({ id, name, description, scope, allowed_models }: { id: number; name: string; description: string, scope: string, allowed_models: number[] }) =>
      updateAPIKey(id, { name, description, scope, allowed_models }),
    onSuccess: async () => {
      toast.success('API key updated successfully.');
      await refreshAPIKeys();
      navigate('/dashboard/settings/developer');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to update API key.'));
    },
  });

  const handleSaveAPIKey = () => {
    if (!apiKeyName.trim()) {
      toast.warning('Please enter an API key name.');
      return;
    }

    if (apiKeyModels.length === 0) {
      toast.warning('Please select at least 1 model for this API key.');
      return;
    }


    if (initialData) {
      updateAPIKeyMutation.mutate({
        id: initialData.id,
        name: apiKeyName.trim(),
        description: apiKeyDescription.trim(),
        scope: apiKeyScope,
        allowed_models: apiKeyModels,
      });
    } else {
      createAPIKeyMutation.mutate({
        name: apiKeyName.trim(),
        description: apiKeyDescription.trim(),
        scope: apiKeyScope,
        allowed_models: apiKeyModels,
      });
    }
  };

  const saving = createAPIKeyMutation.isPending || updateAPIKeyMutation.isPending;

  return {
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
  };
}
