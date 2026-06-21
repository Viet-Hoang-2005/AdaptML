import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteAPIKey,
  listAPIKeys,
  regenerateAPIKey,
} from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { queryKeys } from '../lib/queryKeys';
import { toast } from '../lib/toast';
import type { APIKeyRecord, CreatedAPIKeyResponse } from '../types/auth';

export function useDeveloperSettings() {
  const queryClient = useQueryClient();
  const [createdApiKey, setCreatedApiKey] = useState<CreatedAPIKeyResponse | null>(null);

  const apiKeysQuery = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: listAPIKeys,
  });

  useEffect(() => {
    if (apiKeysQuery.isError) {
      toast.error(getApiErrorMessage(apiKeysQuery.error, 'Unable to load API keys.'));
    }
  }, [apiKeysQuery.error, apiKeysQuery.isError]);

  const refreshAPIKeys = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
  };


  const deleteAPIKeyMutation = useMutation({
    mutationFn: deleteAPIKey,
    onSuccess: async () => {
      toast.success('API key deleted successfully.');
      await refreshAPIKeys();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to delete API key.'));
    },
  });

  const regenerateAPIKeyMutation = useMutation({
    mutationFn: regenerateAPIKey,
    onSuccess: async (response) => {
      setCreatedApiKey(response);
      await refreshAPIKeys();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to regenerate API key.'));
    },
  });


  const handleDeleteAPIKey = async (apiKey: APIKeyRecord) => {
    deleteAPIKeyMutation.mutate(apiKey.id);
  };

  const handleRegenerateAPIKey = async (apiKey: APIKeyRecord) => {
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

  return {
    apiKeys: apiKeysQuery.data?.api_keys ?? [],
    loading: apiKeysQuery.isLoading,
    createdApiKey,
    setCreatedApiKey,
    handleDeleteAPIKey,
    handleRegenerateAPIKey,
    handleCopyCreatedKey,
  };
}
