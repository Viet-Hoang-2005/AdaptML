/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Component } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { getRegistryFamilies, getRegistryVersions } from '../../lib/api';
import type { RegistryFamily, RegistryVersion } from '../../types/modelApi';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';

import { ModelFamilyList } from '../../components/model-evolution/ModelFamilyList';
import { ModelFamilyDetail } from '../../components/model-evolution/ModelFamilyDetail';
import { ModelVersionDetail } from '../../components/model-evolution/ModelVersionDetail';

export default function ModelEvolutionPage() {
  const { familyId } = useParams<{ familyId?: string }>();
  const navigate = useNavigate();

  const [families, setFamilies] = useState<RegistryFamily[]>([]);
  const [loadingFamilies, setLoadingFamilies] = useState(true);
  
  const [selectedFamily, setSelectedFamily] = useState<RegistryFamily | null>(null);
  const [versions, setVersions] = useState<RegistryVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  
  const [selectedVersion, setSelectedVersion] = useState<RegistryVersion | null>(null);

  const fetchFamilies = useCallback(async () => {
    try {
      setLoadingFamilies(true);
      const data = await getRegistryFamilies();
      setFamilies(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to fetch registry families.'));
    } finally {
      setLoadingFamilies(false);
    }
  }, []);

  const fetchVersions = useCallback(async (family: RegistryFamily) => {
    try {
      setLoadingVersions(true);
      const data = await getRegistryVersions(family.id);
      setVersions(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to fetch family versions.'));
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  useEffect(() => {
    void fetchFamilies();
  }, [fetchFamilies]);

  // Handle URL sync and selection
  useEffect(() => {
    if (loadingFamilies) return;

    if (families.length === 0) {
      setSelectedFamily(null);
      setVersions([]);
      setSelectedVersion(null);
      return;
    }

    let targetFamily = families[0];
    if (familyId) {
      const found = families.find(f => f.id.toString() === familyId);
      if (found) targetFamily = found;
    }

    if (targetFamily.id !== selectedFamily?.id) {
      setSelectedFamily(targetFamily);
      setSelectedVersion(null);
      void fetchVersions(targetFamily);
      
      // Update URL if we auto-selected
      if (!familyId || familyId !== targetFamily.id.toString()) {
        navigate(`/dashboard/model-evolution/${targetFamily.id}`, { replace: true });
      }
    }
  }, [families, familyId, loadingFamilies, navigate, selectedFamily, fetchVersions]);

  // Auto-select version when versions load
  useEffect(() => {
    if (loadingVersions || versions.length === 0) return;
    if (!selectedVersion) {
      // Pick production, or latest
      const prodVersion = versions.find(v => v.stage === 'production');
      if (prodVersion) {
        setSelectedVersion(prodVersion);
      } else {
        setSelectedVersion(versions[0]);
      }
    }
  }, [versions, loadingVersions, selectedVersion]);

  const handleRefresh = async () => {
    await fetchFamilies();
    if (selectedFamily) {
      await fetchVersions(selectedFamily);
    }
    toast.success('Data refreshed.');
  };

  const handleActionSuccess = () => {
    // Re-fetch families to update current_production_version
    void fetchFamilies();
    // Re-fetch versions for current family
    if (selectedFamily) {
      void fetchVersions(selectedFamily);
    }
  };

  const totalFamilies = families.length;
  const prodFamilies = families.filter(f => f.current_production_version).length;

  return (
    <div className="flex flex-col h-full flex-1">
      {/* Header Section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6 px-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Model Evolution</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track model versions, metrics, and production promotion history through the native Model Registry.
          </p>
        </div>
        <div className="flex gap-3">
          <Button 
            size="md" 
            variant="secondary" 
            icon={<RefreshCw className="h-4 w-4" />} 
            onClick={() => void handleRefresh()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 px-4 lg:grid-cols-3 mb-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-500 mb-1">Total Families</p>
          <p className="text-3xl font-bold text-gray-900">{loadingFamilies ? '-' : totalFamilies}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-500 mb-1">Production Active</p>
          <p className="text-3xl font-bold text-gray-900">{loadingFamilies ? '-' : prodFamilies}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-500 mb-1">Registry Status</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-sm font-medium text-emerald-700">Online & Syncing</span>
          </div>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 px-4 pb-6 min-h-0">
        
        {/* Left Panel: Family List */}
        <div className="w-full lg:w-1/3 flex flex-col min-h-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
              <Component className="h-4 w-4" />
              Families
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <ModelFamilyList 
              families={families} 
              loading={loadingFamilies} 
              selectedFamilyId={selectedFamily?.id} 
              onSelect={(f) => navigate(`/dashboard/model-evolution/${f.id}`)}
            />
          </div>
        </div>

        {/* Right Panel: Detail Workspace */}
        <div className="w-full lg:w-2/3 flex flex-col min-h-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden overflow-y-auto">
          {selectedFamily ? (
            <div className="p-6 flex flex-col gap-6">
              <ModelFamilyDetail 
                family={selectedFamily} 
                versions={versions} 
                loading={loadingVersions} 
                selectedVersionId={selectedVersion?.id}
                onSelectVersion={setSelectedVersion}
              />
              
              {selectedVersion && (
                <ModelVersionDetail 
                  family={selectedFamily}
                  version={selectedVersion} 
                  onActionSuccess={handleActionSuccess}
                />
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="rounded-full bg-gray-50 p-4 mb-4">
                <Component className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">No Model Family Selected</h3>
              <p className="mt-2 text-sm text-gray-500 max-w-sm">
                Select a model family from the list on the left, or upload a new model to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
