import { useState } from 'react';
import type { RegistryFamily, RegistryVersion } from '../../types/modelApi';
import { Copy, Terminal, ExternalLink, ArrowUpCircle, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';

import { ModelMetricsPanel } from './ModelMetricsPanel';
import { ModelHistoryTimeline } from './ModelHistoryTimeline';
import { PromoteVersionModal } from './PromoteVersionModal';
import { RollbackVersionModal } from './RollbackVersionModal';

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  onActionSuccess: () => void;
}

export function ModelVersionDetail({ family, version, onActionSuccess }: Props) {
  const [activeTab, setActiveTab] = useState<'details' | 'metrics' | 'history'>('details');
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);

  const isProd = version.stage === 'production';

  const copyEndpoint = async () => {
    if (!version.endpoint_url) return;
    await navigator.clipboard.writeText(version.endpoint_url);
    toast.success('Endpoint URL copied to clipboard.');
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
          <div className="flex flex-col gap-8">
            
            {/* Version Header Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-50 p-5 rounded-xl border border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  Version {version.version}
                  {isProd && <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Production</span>}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Source: {version.source_type} {version.source_training_job_id ? `(Job ID: ${version.source_training_job_id})` : ''}
                </p>
              </div>
              <div className="flex gap-3">
                <Button 
                  size="md" 
                  variant="secondary"
                  icon={<RotateCcw className="h-4 w-4" />} 
                  disabled={isProd}
                  onClick={() => setIsRollbackModalOpen(true)}
                >
                  Rollback
                </Button>
                <Button 
                  size="md" 
                  variant="primary"
                  icon={<ArrowUpCircle className="h-4 w-4" />} 
                  disabled={isProd}
                  onClick={() => setIsPromoteModalOpen(true)}
                >
                  {isProd ? 'Already Production' : 'Promote to Production'}
                </Button>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="grid md:grid-cols-2 gap-6">
              
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Deployment Info</h4>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Image Name</p>
                  <p className="mt-1 text-sm font-mono text-gray-800 break-all">{version.image_name || 'N/A'}</p>
                </div>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-2">
                    <Terminal className="h-4 w-4" /> Endpoint URL
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs font-mono text-gray-800 bg-white border border-gray-300 px-2 py-1 rounded w-full truncate">
                      {version.endpoint_url || 'N/A'}
                    </code>
                    {version.endpoint_url && (
                      <Button size="sm" variant="secondary" onClick={copyEndpoint} className="px-2">
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Artifact Info</h4>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Artifact URI</p>
                  <p className="mt-1 text-sm font-mono text-gray-800 break-all">{version.artifact_uri || 'N/A'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Created</p>
                    <p className="mt-1 text-sm text-gray-800">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Updated</p>
                    <p className="mt-1 text-sm text-gray-800">{new Date(version.updated_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            {version.endpoint_url && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-blue-900">API Endpoint Ready</p>
                  <p className="text-sm text-blue-700 mt-1">This version is actively running. You can test predictions against it.</p>
                </div>
                <Button 
                  size="md" 
                  variant="primary" 
                  icon={<ExternalLink className="h-4 w-4" />}
                  onClick={() => window.open(`/dashboard/home/model-testing`, '_blank')}
                >
                  Test Predictions
                </Button>
              </div>
            )}
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
    </div>
  );
}
