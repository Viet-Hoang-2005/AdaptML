import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  buildModelAPI,
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
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Model API uploaded successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to upload model API.'));
    },
  });

  const buildMutation = useMutation({
    mutationFn: buildModelAPI,
    onSuccess: async (model) => {
      await invalidateModels();
      toast.success('MLflow package built and deployed successfully.');
      navigate(`/dashboard/api-management/${model.id}`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to build MLflow package.'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ modelId, payload }: { modelId: string; payload: ModelAPIFormValues }) =>
      updateModelAPI(modelId, payload),
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Model API updated successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to update model API.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (modelId: string) => deleteModelAPI(modelId, true),
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
    createModelAPI: createMutation.mutateAsync,
    buildModelAPI: buildMutation.mutateAsync,
    updateModelAPI: updateMutation.mutateAsync,
    deleteModelAPI: deleteMutation.mutateAsync,
    creating: createMutation.isPending,
    building: buildMutation.isPending,
    updating: updateMutation.isPending,
    deleting: deleteMutation.isPending,
  };
}
