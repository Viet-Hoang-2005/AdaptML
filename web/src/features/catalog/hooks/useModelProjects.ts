import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createModelProject,
  deleteModelProject,
  listModelProjects,
  updateModelProject,
} from '@/features/catalog/api/catalogApi';
import { buildModelProject } from '@/features/build-deploy/api/buildDeployApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { catalogQueryKeys } from '@/features/catalog/queryKeys';
import { toast } from '@/shared/ui/toastStore';
import type { ModelProjectFormValues } from '@/features/catalog/types';

export function useModelProjects() {
  return useQuery({
    queryKey: catalogQueryKeys.projects(),
    queryFn: listModelProjects,
  });
}

export function useModelProjectMutations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const invalidateModels = () => queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });

  const createMutation = useMutation({
    mutationFn: createModelProject,
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Model API uploaded successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to upload model API.'));
    },
  });

  const buildMutation = useMutation({
    mutationFn: buildModelProject,
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
    mutationFn: ({ modelId, payload }: { modelId: string; payload: ModelProjectFormValues }) =>
      updateModelProject(modelId, payload),
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Model API updated successfully.');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to update model API.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (modelId: string) => deleteModelProject(modelId, true),
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
    createModelProject: createMutation.mutateAsync,
    buildModelProject: buildMutation.mutateAsync,
    updateModelProject: updateMutation.mutateAsync,
    deleteModelProject: deleteMutation.mutateAsync,
    creating: createMutation.isPending,
    building: buildMutation.isPending,
    updating: updateMutation.isPending,
    deleting: deleteMutation.isPending,
  };
}
