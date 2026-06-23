import { useState } from 'react';
import type { RegistryFamily, RegistryVersion } from '../../types/modelApi';
import { Copy, Terminal, ExternalLink, ArrowUpCircle, RotateCcw, GitCompare, Check } from 'lucide-react';
import { formatVersion } from '../../lib/formatters';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';

import { ModelMetricsPanel } from './ModelMetricsPanel';
import { ModelHistoryTimeline } from './ModelHistoryTimeline';
import { PromoteVersionModal } from './PromoteVersionModal';
import { RollbackVersionModal } from './RollbackVersionModal';
import { VersionComparisonModal } from './VersionComparisonModal';

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  allVersions: RegistryVersion[];
  onActionSuccess: () => void;
}

export function ModelVersionDetail({ family, version, allVersions, onActionSuccess }: Props) {
  const [activeTab, setActiveTab] = useState<'details' | 'metrics' | 'history'>('details');
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const isProd = version.stage === 'production';

  const [copied, setCopied] = useState(false);

  const copyEndpoint = async () => {
    if (!version.endpoint_url) return;
    await navigator.clipboard.writeText(version.endpoint_url);
    toast.success('Endpoint URL copied to clipboard.');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSuccess = () => {
    onActionSuccess();
    // Keep user on details tab to see updated state
    setActiveTab('details');
  };

  return (
    <div className="flex flex-col border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
      
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 bg-gray-50 px-4 pt-3">
        {(['details', 'metrics', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-semibold capitalize border-b-2 transition-colors ${
              activeTab === tab 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="flex-1"></div>
      </div>

      <div className="p-6">
        {activeTab === 'details' && (
          <div className="flex flex-col gap-6">
            
            {/* A. Version Control Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <h3 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
                  Version {formatVersion(version.version)}
                  {isProd && (
                    <span className="bg-emerald-500 text-white text-xs px-2.5 py-0.5 rounded uppercase tracking-wider font-bold shadow-sm">
                      PRODUCTION ACTIVE
                    </span>
                  )}
                  {!isProd && (
                    <span className="bg-gray-100 text-gray-600 text-xs px-2.5 py-0.5 rounded uppercase tracking-wider font-bold">
                      {version.stage}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-gray-500 mt-2 font-medium">
                  Source: {version.source_type.replace('_', ' ')} {version.source_training_job_id ? `· Job ID: ${version.source_training_job_id}` : ''}
                </p>
              </div>

              {/* B. Action Row */}
              <div className="flex flex-wrap gap-2 md:gap-3">
                <Button 
                  size="md" 
                  variant="secondary"
                  icon={<GitCompare className="h-4 w-4" />} 
                  onClick={() => setIsCompareModalOpen(true)}
                >
                  Compare
                </Button>
                
                {version.endpoint_url && (
                  <Button 
                    size="md" 
                    variant="secondary" 
                    icon={<ExternalLink className="h-4 w-4" />}
                    onClick={() => window.open(`/dashboard/home/model-testing`, '_blank')}
                  >
                    Test Predictions
                  </Button>
                )}

                <Button 
                  size="md" 
                  variant="secondary"
                  icon={<RotateCcw className="h-4 w-4" />} 
                  disabled={isProd}
                  onClick={() => setIsRollbackModalOpen(true)}
                  title={isProd ? 'Cannot rollback the active production version' : 'Rollback to this version'}
                >
                  Rollback
                </Button>
                
                {isProd ? (
                  <div className="flex items-center px-4 py-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                    Registry production active
                  </div>
                ) : (
                  <Button 
                    size="md" 
                    variant="primary"
                    icon={<ArrowUpCircle className="h-4 w-4" />} 
                    onClick={() => setIsPromoteModalOpen(true)}
                  >
                    Promote to Production
                  </Button>
                )}
              </div>
            </div>

            {/* C. Production Semantics Callout */}
            {isProd && (
              <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 flex flex-col gap-1 text-emerald-800">
                <div className="text-sm">
                  <strong>Registry production marker is active.</strong> Live traffic routing is not enabled yet.
                </div>
                <div className="text-xs text-emerald-700/80">
                  Versioned endpoints remain unchanged until Phase 11.
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6 mt-2">
              {/* D. Deployment Info */}
              <div className="flex flex-col gap-4 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center justify-between border-b border-gray-100 pb-2">
                  Deployment Info
                  {version.endpoint_url ? (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Ready</span>
                  ) : (
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">No Endpoint</span>
                  )}
                </h4>
                
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Image Name</p>
                  <p className="text-sm font-mono text-gray-800 break-all">{version.image_name || 'N/A'}</p>
                </div>
                
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-2 mb-1">
                    <Terminal className="h-3 w-3" /> Endpoint URL
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded flex-1 truncate select-all">
                      {version.endpoint_url || 'N/A'}
                    </code>
                    {version.endpoint_url && (
                      <Button size="sm" variant="secondary" onClick={copyEndpoint} className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-gray-300">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-gray-500" />}
                        <span className={copied ? "text-emerald-700" : "text-gray-700"}>{copied ? 'Copied' : 'Copy'}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* E. Artifact Info */}
              <div className="flex flex-col gap-4 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-100 pb-2">Artifact Info</h4>
                
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Artifact URI</p>
                  <p className="text-sm font-mono text-gray-800 break-all">{version.artifact_uri || 'N/A'}</p>
                </div>

                {/* Phase 10E.1: MLflow Run Lineage */}
                <div className="border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">MLflow Run</p>
                    {version.mlflow_run_url ? (
                      <a
                        href={version.mlflow_run_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1 rounded-full transition-colors"
                        title="Open in MLflow (internal/admin tool)"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open in MLflow
                      </a>
                    ) : null}
                  </div>

                  {version.mlflow_run_id ? (
                    <div className="flex flex-col gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-0.5">Run ID</p>
                        <code className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 rounded break-all block select-all">
                          {version.mlflow_run_id}
                        </code>
                      </div>
                      {version.mlflow_model_uri && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-0.5">Model URI</p>
                          <code className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 rounded break-all block">
                            {version.mlflow_model_uri}
                          </code>
                        </div>
                      )}
                      <p className="text-[11px] text-gray-400 leading-relaxed mt-1">
                        MLflow is used for experiment lineage and artifact deep dives.
                        The Native Registry remains the source of truth for deployment and promotion.{' '}
                        <span className="font-medium text-amber-600">MLflow UI is internal/admin only.</span>
                      </p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-3 flex flex-col gap-1">
                      <p className="text-xs font-semibold text-gray-500">No MLflow run linked</p>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Emit <code className="bg-white border border-gray-200 px-1 rounded font-mono">MLFLOW_RUN_ID</code> from your training script, or use the MLflow-enabled training template.
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Created</p>
                    <p className="text-sm text-gray-800 font-medium">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Updated</p>
                    <p className="text-sm text-gray-800 font-medium">{new Date(version.updated_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}


        {activeTab === 'metrics' && <ModelMetricsPanel familyId={family.id} versionId={version.id} />}
        
        {activeTab === 'history' && <ModelHistoryTimeline familyId={family.id} />}

      </div>

      {isPromoteModalOpen && (
        <PromoteVersionModal 
          family={family} 
          version={version} 
          onClose={() => setIsPromoteModalOpen(false)} 
          onSuccess={() => {
            setIsPromoteModalOpen(false);
            handleSuccess();
          }} 
        />
      )}

      {isRollbackModalOpen && (
        <RollbackVersionModal 
          family={family} 
          version={version} 
          onClose={() => setIsRollbackModalOpen(false)} 
          onSuccess={() => {
            setIsRollbackModalOpen(false);
            handleSuccess();
          }} 
        />
      )}

      {isCompareModalOpen && (
        <VersionComparisonModal 
          family={family} 
          versions={allVersions} 
          onClose={() => setIsCompareModalOpen(false)} 
        />
      )}
    </div>
  );
}
