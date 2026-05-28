import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createModelAPI,
  deleteModelAPI,
  listModelAPIs,
  updateModelAPI,
} from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { queryKeys } from '../lib/queryKeys';
import { toast } from '../lib/toast';
import type { ModelAPIFormValues } from '../types/modelApi';

export function useModelAPIs() {
  return useQuery({
    queryKey: queryKeys.modelApis,
    queryFn: listModelAPIs,
  });
}

export function useModelAPIMutations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const invalidateModels = () => queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });

  const createMutation = useMutation({
    mutationFn: createModelAPI,
    onSuccess: async (model) => {
      await invalidateModels();
      toast.success('Model API uploaded successfully.');
      navigate(`/dashboard/api-management/${model.id}`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to upload model API.'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ modelId, payload }: { modelId: number; payload: ModelAPIFormValues }) =>
      updateModelAPI(modelId, payload),
    onSuccess: async (model) => {
      await invalidateModels();
      toast.success('Model API updated successfully.');
      navigate(`/dashboard/api-management/${model.id}`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to update model API.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteModelAPI,
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Model API disabled successfully.');
      navigate('/dashboard/api-management');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to disable model API.'));
    },
  });

  return {
    createModelAPI: createMutation.mutate,
    updateModelAPI: updateMutation.mutate,
    deleteModelAPI: deleteMutation.mutate,
    creating: createMutation.isPending,
    updating: updateMutation.isPending,
    deleting: deleteMutation.isPending,
  };
}
