import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Component } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/PageHeader';
import { getRegistryFamilies, getRegistryVersion, getRegistryVersions } from '@/features/registry/api/registryApi';
import type { RegistryFamily, RegistryVersion } from '@/features/registry/types';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import { useTranslation } from 'react-i18next';

import { ModelFamilyList } from '@/features/registry/components/ModelFamilyList';
import { ModelFamilyDetail } from '@/features/registry/components/ModelFamilyDetail';
import { ModelVersionDetail } from '@/features/registry/components/ModelVersionDetail';

export default function ModelEvolutionPage() {
  const { t } = useTranslation('registry');
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
      await Promise.resolve();
      setLoadingFamilies(true);
      const data = await getRegistryFamilies();
      setFamilies(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('familyLoadFailed')));
    } finally {
      setLoadingFamilies(false);
    }
  }, [t]);

  const fetchVersions = useCallback(async (family: RegistryFamily) => {
    try {
      setLoadingVersions(true);
      const data = await getRegistryVersions(family.id);
      setVersions(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('versionsLoadFailed')));
    } finally {
      setLoadingVersions(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchFamilies();
    });
  }, [fetchFamilies]);

  // Handle URL sync and selection
  useEffect(() => {
    if (loadingFamilies) return;

    if (families.length === 0) {
      queueMicrotask(() => {
        setSelectedFamily(null);
        setVersions([]);
        setSelectedVersion(null);
      });
      return;
    }

    let targetFamily = families[0];
    if (familyId) {
      const found = families.find(f => f.id.toString() === familyId);
      if (found) targetFamily = found;
    }

    if (targetFamily.id !== selectedFamily?.id) {
      queueMicrotask(() => {
        setSelectedFamily(targetFamily);
        setSelectedVersion(null);
        void fetchVersions(targetFamily);
      });
      
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
      queueMicrotask(() => {
        if (prodVersion) {
          setSelectedVersion(prodVersion);
        } else {
          setSelectedVersion(versions[0]);
        }
      });
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
          toast.error(getApiErrorMessage(error, t('versionLoadFailed')));
        }
      } finally {
        if (!cancelled) setLoadingVersionDetail(false);
      }
    };

    void fetchVersionDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedVersion?.id, t]);

  const handleRefresh = async () => {
    await fetchFamilies();
    if (selectedFamily) {
      await fetchVersions(selectedFamily);
    }
    toast.success(t('refreshed'));
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
  const aliasFamilies = families.filter(f => (
    f.production_alias_version_id
    || f.productionAliasVersionId
    || f.latest_alias_version_id
    || f.latestAliasVersionId
    || f.champion_alias_version_id
    || f.championAliasVersionId
  )).length;

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      {/* Header Section */}
      <PageHeader title={t('title')}>
        <div className="flex gap-3">
          <Button 
            size="sm" 
            variant="secondary" 
            icon={<RefreshCw className="h-4 w-4" />} 
            onClick={() => void handleRefresh()}
          >
            {t('refresh')}
          </Button>
        </div>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{t('totalFamilies')}</p>
          <p className="text-3xl font-extrabold text-foreground">{loadingFamilies ? '-' : totalFamilies}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{t('productionActive')}</p>
          <p className="text-3xl font-extrabold text-success">{loadingFamilies ? '-' : prodFamilies}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t('registryStatus')}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
            </span>
            <span className="text-sm font-bold text-success">{t('online')}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{t('routingAlias')}</p>
          <p className="text-3xl font-extrabold text-indigo-600">{loadingFamilies ? '-' : aliasFamilies}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 uppercase font-semibold tracking-wider">{t('aliasDescription')}</p>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        
        {/* Left Panel: Family List */}
        <div className="w-full lg:w-1/3 flex flex-col rounded-2xl border border-border bg-surface shadow-sm overflow-hidden sticky top-6">
          <div className="p-4 border-b border-border bg-muted/80 backdrop-blur-sm">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Component className="h-4 w-4" />
              {t('families')}
            </h2>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-3 bg-muted/30">
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
            <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-border rounded-2xl bg-muted/50">
              <div className="rounded-full bg-surface border border-border p-5 mb-5 shadow-sm">
                <Component className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-bold text-foreground">{t('noSelection')}</h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                {t('noSelectionDescription')}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
