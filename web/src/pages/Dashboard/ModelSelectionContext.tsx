import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { mockModels, ModelSelectionContext } from './modelSelection';
import type { ModelSelectionContextValue } from './modelSelection';

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedModelId, setSelectedModelId] = useState(mockModels[0]?.id ?? '');

  const value = useMemo<ModelSelectionContextValue>(() => {
    const selectedModel = mockModels.find((model) => model.id === selectedModelId) ?? null;

    return {
      models: mockModels,
      selectedModel,
      selectModel: setSelectedModelId,
    };
  }, [selectedModelId]);

  return (
    <ModelSelectionContext.Provider value={value}>
      {children}
    </ModelSelectionContext.Provider>
  );
}
