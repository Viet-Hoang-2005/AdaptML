import { createContext, useContext } from 'react';

export interface DashboardModel {
  id: string;
  name: string;
  status: 'Connected' | 'Idle' | 'Training';
}

export const mockModels: DashboardModel[] = [
  { id: 'cicids-demo', name: 'CICIDS Demo Model', status: 'Connected' },
  { id: 'fraud-detector', name: 'Fraud Detector Baseline', status: 'Idle' },
  { id: 'traffic-classifier', name: 'Traffic Classifier v2', status: 'Training' },
];

export interface ModelSelectionContextValue {
  models: DashboardModel[];
  selectedModel: DashboardModel | null;
  selectModel: (modelId: string) => void;
}

export const ModelSelectionContext = createContext<ModelSelectionContextValue | undefined>(undefined);

export function useModelSelection() {
  const context = useContext(ModelSelectionContext);
  if (!context) {
    throw new Error('useModelSelection must be used inside ModelSelectionProvider.');
  }
  return context;
}
