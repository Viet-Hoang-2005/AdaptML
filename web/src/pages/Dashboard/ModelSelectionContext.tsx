import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useModelAPIs } from '../../hooks/useModelAPIs';
import { ModelSelectionContext } from '../../hooks/useModelSelection';
import type { ModelSelectionContextValue } from '../../hooks/useModelSelection';

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedModelId, setSelectedModelId] = useState<number | null>(() => {
    const stored = localStorage.getItem('selected_model_api_id');
    return stored ? Number(stored) : null;
  });
  const { data, isLoading } = useModelAPIs();
  const models = useMemo(() => data?.models ?? [], [data?.models]);

  const value = useMemo<ModelSelectionContextValue>(() => {
    const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0] ?? null;

    return {
      models,
      selectedModel,
      selectModel: (modelId: number) => {
        setSelectedModelId(modelId);
        localStorage.setItem('selected_model_api_id', String(modelId));
      },
      loading: isLoading,
    };
  }, [isLoading, models, selectedModelId]);

  return (
    <ModelSelectionContext.Provider value={value}>
      {children}
    </ModelSelectionContext.Provider>
  );
}
