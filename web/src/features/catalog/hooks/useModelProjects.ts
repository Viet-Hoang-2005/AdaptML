import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createModelProject,
  deleteModelProject,
  listModelProjects,
  updateModelProject,
} from '@/features/catalog/api/catalogApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { catalogQueryKeys } from '@/features/catalog/queryKeys';
import { toast } from '@/shared/components/toastStore';
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
      toast.success('Model project deletion started.');
      navigate('/dashboard/management');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Unable to delete model project.'));
    },
  });

  return {
    createModelProject: createMutation.mutateAsync,
    updateModelProject: updateMutation.mutateAsync,
    deleteModelProject: deleteMutation.mutateAsync,
    creating: createMutation.isPending,
    updating: updateMutation.isPending,
    deleting: deleteMutation.isPending,
  };
}
