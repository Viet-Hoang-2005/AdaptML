import { useMemo, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, matchPath } from 'react-router-dom';
import { useModelAPIs } from '../../hooks/useModelAPIs';
import { ModelSelectionContext } from '../../hooks/useModelSelection';
import type { ModelSelectionContextValue } from '../../hooks/useModelSelection';

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Try to parse modelId from URL
  const match = useMemo(() => {
    return matchPath("/dashboard/home/model-api/:modelId", location.pathname) ||
      matchPath("/dashboard/home/model-testing/:modelId", location.pathname) ||
      matchPath("/dashboard/drift-monitoring/:modelId", location.pathname) ||
      matchPath("/dashboard/model-training/:modelId", location.pathname) ||
      matchPath("/dashboard/model-evolution/:modelId", location.pathname);
  }, [location.pathname]);

  const urlModelId = match?.params.modelId ? Number(match.params.modelId) : null;

  const [localModelId, setLocalModelId] = useState<number | null>(() => {
    const stored = localStorage.getItem('selected_model_api_id');
    return stored ? Number(stored) : null;
  });

  const [prevUrlModelId, setPrevUrlModelId] = useState(urlModelId);
  if (urlModelId && urlModelId !== prevUrlModelId) {
    setPrevUrlModelId(urlModelId);
    setLocalModelId(urlModelId);
    localStorage.setItem('selected_model_api_id', String(urlModelId));
  }

  const { data, isLoading } = useModelAPIs();
  const models = useMemo(() => data?.models ?? [], [data?.models]);

  const activeModelId = urlModelId || localModelId;

  const value = useMemo<ModelSelectionContextValue>(() => {
    const selectedModel = models.find((model) => model.id === activeModelId) ?? models[0] ?? null;

    return {
      models,
      selectedModel,
      selectModel: (modelId: number) => {
        setLocalModelId(modelId);
        localStorage.setItem('selected_model_api_id', String(modelId));
        
        if (match) {
          const basePath = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
          navigate(`${basePath}/${modelId}${location.search}${location.hash}`);
        } else {
          const supportedBases = ['/dashboard/home/model-api', '/dashboard/home/model-testing', '/dashboard/drift-monitoring', '/dashboard/model-training', '/dashboard/model-evolution'];
          const base = supportedBases.find(b => location.pathname === b || location.pathname === `${b}/`);
          if (base) {
             navigate(`${base}/${modelId}${location.search}${location.hash}`);
          }
        }
      },
      loading: isLoading,
    };
  }, [isLoading, models, activeModelId, match, location, navigate]);

  // Auto-redirect if on a supported base path without a model ID
  useEffect(() => {
    const selectedModel = value.selectedModel;
    if (!selectedModel) return;
    
    const supportedBases = [
      '/dashboard/home/model-api',
      '/dashboard/home/model-testing',
      '/dashboard/drift-monitoring',
      '/dashboard/model-training',
      '/dashboard/model-evolution'
    ];
    
    const baseMatch = supportedBases.find(b => location.pathname === b || location.pathname === `${b}/`);
    if (baseMatch) {
      navigate(`${baseMatch}/${selectedModel.id}${location.search}${location.hash}`, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, value.selectedModel, navigate]);

  return (
    <ModelSelectionContext.Provider value={value}>
      {children}
    </ModelSelectionContext.Provider>
  );
}
