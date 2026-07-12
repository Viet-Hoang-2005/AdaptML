import type { RegistryFamily, RegistryVersion } from '../../types/models';
import { Layers, Star, Info, FileCode2, Activity, ArrowRight, GitCommit } from 'lucide-react';
import { formatVersion } from '../../lib/formatters';

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

interface Props {
  family: RegistryFamily;
  versions: RegistryVersion[];
  loading: boolean;
  selectedVersionId?: string;
  onSelectVersion: (v: RegistryVersion) => void;
}

function VersionLineage({ versions, selectedVersionId, onSelectVersion }: { versions: RegistryVersion[], selectedVersionId?: string, onSelectVersion: (v: RegistryVersion) => void }) {
  if (versions.length === 0) return null;
  // Sort oldest to newest for chronological lineage
  const chronological = [...versions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (versions.length === 1) {
    const v = versions[0];
    const isProd = v.stage === 'production';
    const isSelected = v.id === selectedVersionId;
    return (
      <div className="px-5 py-4 border-b border-gray-100 bg-white flex flex-col gap-2">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Version Lineage</span>
        <div className="flex">
          <button
            onClick={() => onSelectVersion(v)}
            className={classNames(
              "relative flex items-center justify-center h-8 px-3 rounded-full border text-xs font-bold transition-all duration-200",
              isSelected 
                ? "border-blue-400 bg-blue-50 text-blue-700 shadow-sm ring-2 ring-blue-500/20" 
                : isProd 
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
            )}
          >
            {isProd && <Star className="h-3 w-3 mr-1.5 text-emerald-500 fill-emerald-500" />}
            {formatVersion(v.version)} {isProd ? 'Production' : ''}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-4 border-b border-gray-100 bg-white flex flex-col gap-2">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Version Lineage</span>
      <div className="flex items-center gap-1 overflow-x-auto pb-2 custom-scrollbar">
        {chronological.map((v, i) => {
          const isProd = v.stage === 'production';
          const isSelected = v.id === selectedVersionId;
          const isLast = i === chronological.length - 1;

          return (
            <div key={v.id} className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onSelectVersion(v)}
                className={classNames(
                  "relative flex items-center justify-center h-8 px-3 rounded-full border text-xs font-bold transition-all duration-200",
                  isSelected 
                    ? "border-blue-400 bg-blue-50 text-blue-700 shadow-sm ring-2 ring-blue-500/20" 
                    : isProd 
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                {isProd && <Star className="h-3 w-3 mr-1.5 text-emerald-500 fill-emerald-500" />}
                {formatVersion(v.version)}
              </button>
              {!isLast && (
                <div className="w-8 h-px bg-gray-300 shrink-0 relative flex items-center justify-center">
                  <ArrowRight className="h-3 w-3 text-gray-300 bg-white absolute" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ModelFamilyDetail({ family, versions, loading, selectedVersionId, onSelectVersion }: Props) {
  const prodVersion = family.current_production_version;
  const isEndpointReady = prodVersion && !!prodVersion.endpoint_url;
  
  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Hero Header */}
      <div className="bg-gray-50 border-b border-gray-200 p-6 flex flex-col gap-4">
        
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <h2 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            {family.display_name || family.name}
          </h2>
          
          <div className="flex flex-wrap items-center gap-2 mt-1 md:mt-0">
            {prodVersion ? (
              <>
                <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded shadow-sm text-xs font-bold uppercase tracking-wider">
                  <Star className="h-3 w-3 fill-emerald-500 text-emerald-500" /> Prod {formatVersion(prodVersion.version)}
                </span>
                {isEndpointReady ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                    <Activity className="h-3 w-3" /> Endpoint Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-gray-600 border border-gray-200 bg-gray-100 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                    No Endpoint
                  </span>
                )}
                <span className="inline-flex items-center text-gray-500 border border-gray-200 bg-white px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                  Registry Marker Only
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-200 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                No Production Version
              </span>
            )}
          </div>
        </div>

        <div>
          {prodVersion && (
            <p className="text-sm text-gray-700 flex items-center gap-1.5 mb-1">
              <GitCommit className="h-4 w-4 text-gray-400" />
              Registered from {prodVersion.source_type.replace('_', ' ')} 
              {prodVersion.source_training_job_id ? ` #${prodVersion.source_training_job_id}` : ''}
            </p>
          )}
          
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 font-medium">
            <span>{versions.length} {versions.length === 1 ? 'version' : 'versions'}</span>
            <span>&middot;</span>
            <span>Updated {new Date(family.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span>&middot;</span>
            <span className="text-gray-400">Routing alias not enabled</span>
          </div>
        </div>
      </div>

      {/* Version Lineage */}
      {!loading && <VersionLineage versions={versions} selectedVersionId={selectedVersionId} onSelectVersion={onSelectVersion} />}

      {/* Version Table */}
      <div className="p-0 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="py-3 pl-5 pr-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Version</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stage</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Endpoint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-gray-500">
                  <div className="flex justify-center mb-2">
                    <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  Loading versions...
                </td>
              </tr>
            ) : versions.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-gray-500">
                  No versions found in this family.
                </td>
              </tr>
            ) : (
              versions.map((v) => {
                const isProd = v.stage === 'production';
                const isSelected = v.id === selectedVersionId;
                return (
                  <tr 
                    key={v.id} 
                    onClick={() => onSelectVersion(v)}
                    className={classNames(
                      "cursor-pointer transition-colors duration-150",
                      isSelected ? "bg-blue-50/50" : "hover:bg-gray-50"
                    )}
                  >
                    <td className="whitespace-nowrap py-4 pl-5 pr-3 text-sm font-medium text-gray-900 flex items-center gap-2">
                      <Layers className={classNames("h-4 w-4", isSelected ? "text-blue-500" : "text-gray-400")} />
                      <span className="font-mono font-semibold">{formatVersion(v.version)}</span>
                      {isProd && <Star className="h-4 w-4 text-amber-400 fill-amber-400 ml-1" />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      <span className={classNames(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
                        v.stage === 'production' ? "bg-emerald-500 text-white shadow-sm" :
                        v.stage === 'staging' ? "bg-blue-100 text-blue-800" :
                        v.stage === 'candidate' ? "bg-purple-100 text-purple-800" :
                        v.stage === 'archived' ? "bg-gray-100 text-gray-800" :
                        "bg-gray-100 text-gray-600"
                      )}>
                        {v.stage}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 flex items-center gap-1.5">
                      {v.source_type === 'training_job' ? <FileCode2 className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                      {v.source_type.replace('_', ' ')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500">
                      {new Date(v.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500">
                      {v.endpoint_url ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                          <Activity className="h-3 w-3" /> Ready
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 font-medium">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
