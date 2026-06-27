/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Component } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { getRegistryFamilies, getRegistryVersion, getRegistryVersions } from '../../lib/api';
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
  const [loadingVersionDetail, setLoadingVersionDetail] = useState(false);

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

  useEffect(() => {
    const versionId = selectedVersion?.id;
    if (!versionId) return;

    let cancelled = false;
    const fetchVersionDetail = async () => {
      try {
        setLoadingVersionDetail(true);
        const detail = await getRegistryVersion(versionId);
        if (cancelled) return;
        setSelectedVersion(detail);
        setVersions(current => current.map(item => item.id === detail.id ? { ...item, ...detail } : item));
      } catch (error) {
        if (!cancelled) {
          toast.error(getApiErrorMessage(error, 'Failed to fetch version detail.'));
        }
      } finally {
        if (!cancelled) setLoadingVersionDetail(false);
      }
    };

    void fetchVersionDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedVersion?.id]);

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
    <div className="flex flex-col min-h-full pb-10">
      {/* Header Section */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6 px-6 pt-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Model Evolution</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-3xl">
            Track version lineage, training metrics, promotion history, and deployment readiness through the native Model Registry.
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
      <div className="grid gap-4 px-6 lg:grid-cols-4 mb-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Total Families</p>
          <p className="text-3xl font-extrabold text-gray-900">{loadingFamilies ? '-' : totalFamilies}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Production Active</p>
          <p className="text-3xl font-extrabold text-emerald-600">{loadingFamilies ? '-' : prodFamilies}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Registry Status</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-sm font-bold text-emerald-700">Online & Syncing</span>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-inner flex flex-col justify-center">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Routing Alias</p>
          <p className="text-lg font-bold text-gray-600">Not Enabled</p>
          <p className="text-[10px] text-gray-400 mt-0.5 uppercase font-semibold tracking-wider">Phase 11 feature</p>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex flex-col lg:flex-row gap-6 px-6 items-start">
        
        {/* Left Panel: Family List */}
        <div className="w-full lg:w-1/3 flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden sticky top-6">
          <div className="p-4 border-b border-gray-200 bg-gray-50/80 backdrop-blur-sm">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Component className="h-4 w-4" />
              Families
            </h2>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-3 bg-gray-50/30">
            <ModelFamilyList 
              families={families} 
              loading={loadingFamilies} 
              selectedFamilyId={selectedFamily?.id} 
              selectedFamilyVersionCount={versions.length}
              onSelect={(f) => navigate(`/dashboard/model-evolution/${f.id}`)}
            />
          </div>
        </div>

        {/* Right Panel: Detail Workspace */}
        <div className="w-full lg:w-2/3 flex flex-col gap-6">
          {selectedFamily ? (
            <>
              <ModelFamilyDetail 
                family={selectedFamily} 
                versions={versions} 
                loading={loadingVersions || loadingVersionDetail} 
                selectedVersionId={selectedVersion?.id}
                onSelectVersion={setSelectedVersion}
              />
              
              {selectedVersion && (
                <ModelVersionDetail 
                  family={selectedFamily}
                  version={selectedVersion} 
                  allVersions={versions}
                  onActionSuccess={handleActionSuccess}
                />
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
              <div className="rounded-full bg-white border border-gray-200 p-5 mb-5 shadow-sm">
                <Component className="h-10 w-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">No Model Family Selected</h3>
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
