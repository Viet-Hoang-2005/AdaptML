import type { RegistryFamily, RegistryVersion } from '@/features/registry/types';
import { Layers, Star, Info, FileCode2, Activity, ArrowRight, GitCommit } from 'lucide-react';
import { formatVersion } from '@/shared/lib/formatters';

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
      <div className="px-5 py-4 border-b border-border bg-surface flex flex-col gap-2">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Version Lineage</span>
        <div className="flex">
          <button
            onClick={() => onSelectVersion(v)}
            className={classNames(
              "relative flex items-center justify-center h-8 px-3 rounded-full border text-xs font-bold transition-all duration-200",
              isSelected 
                ? "border-primary bg-primary-subtle text-primary ring-2 ring-primary/20"
                : isProd 
                  ? "border-success/30 bg-success-subtle text-success"
                  : "border-border bg-surface text-muted-foreground hover:border-border hover:bg-muted"
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
    <div className="px-5 py-4 border-b border-border bg-surface flex flex-col gap-2">
      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Version Lineage</span>
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
                    ? "border-primary bg-primary-subtle text-primary ring-2 ring-primary/20"
                    : isProd 
                      ? "border-success/30 bg-success-subtle text-success"
                      : "border-border bg-surface text-muted-foreground hover:border-border hover:bg-muted"
                )}
              >
                {isProd && <Star className="h-3 w-3 mr-1.5 text-emerald-500 fill-emerald-500" />}
                {formatVersion(v.version)}
              </button>
              {!isLast && (
                <div className="w-8 h-px bg-border shrink-0 relative flex items-center justify-center">
                  <ArrowRight className="h-3 w-3 text-muted-foreground bg-surface absolute" />
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
    <div className="flex flex-col border border-border rounded-xl overflow-hidden bg-surface shadow-sm">
      {/* Hero Header */}
      <div className="bg-muted border-b border-border p-6 flex flex-col gap-4">
        
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <h2 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            {family.display_name || family.name}
          </h2>
          
          <div className="flex flex-wrap items-center gap-2 mt-1 md:mt-0">
            {prodVersion ? (
              <>
                <span className="inline-flex items-center gap-1 text-success bg-success-subtle px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                  <Star className="h-3 w-3 fill-emerald-500 text-emerald-500" /> Prod {formatVersion(prodVersion.version)}
                </span>
                {isEndpointReady ? (
                  <span className="inline-flex items-center gap-1 text-success border border-success/20 bg-success-subtle px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                    <Activity className="h-3 w-3" /> Endpoint Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground border border-border bg-muted px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                    No Endpoint
                  </span>
                )}
                <span className="inline-flex items-center text-muted-foreground border border-border bg-surface px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider">
                  Registry Marker Only
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground bg-muted px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                No Production Version
              </span>
            )}
          </div>
        </div>

        <div>
          {prodVersion && (
            <p className="text-sm text-foreground flex items-center gap-1.5 mb-1">
              <GitCommit className="h-4 w-4 text-muted-foreground" />
              Registered from {prodVersion.source_type.replace('_', ' ')} 
              {prodVersion.source_training_job_id ? ` #${prodVersion.source_training_job_id}` : ''}
            </p>
          )}
          
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground font-medium">
            <span>{versions.length} {versions.length === 1 ? 'version' : 'versions'}</span>
            <span>&middot;</span>
            <span>Updated {new Date(family.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span>&middot;</span>
            <span className="text-muted-foreground">Routing alias not enabled</span>
          </div>
        </div>
      </div>

      {/* Version Lineage */}
      {!loading && <VersionLineage versions={versions} selectedVersionId={selectedVersionId} onSelectVersion={onSelectVersion} />}

      {/* Version Table */}
      <div className="p-0 overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="py-3 pl-5 pr-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Version</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stage</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Updated</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Endpoint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                  <div className="flex justify-center mb-2">
                    <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  Loading versions...
                </td>
              </tr>
            ) : versions.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
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
                      isSelected ? "bg-primary-subtle" : "hover:bg-muted"
                    )}
                  >
                    <td className="whitespace-nowrap py-4 pl-5 pr-3 text-sm font-medium text-foreground flex items-center gap-2">
                      <Layers className={classNames("h-4 w-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                      <span className="font-mono font-semibold">{formatVersion(v.version)}</span>
                      {isProd && <Star className="h-4 w-4 text-amber-400 fill-amber-400 ml-1" />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-muted-foreground">
                      <span className={classNames(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
                        v.stage === 'production' ? "bg-success text-primary-foreground" :
                        v.stage === 'staging' ? "bg-primary-subtle text-primary" :
                        v.stage === 'candidate' ? "bg-warning-subtle text-warning" :
                        v.stage === 'archived' ? "bg-muted text-foreground" :
                        "bg-muted text-muted-foreground"
                      )}>
                        {v.stage}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-muted-foreground flex items-center gap-1.5">
                      {v.source_type === 'training_job' ? <FileCode2 className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                      {v.source_type.replace('_', ' ')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-muted-foreground">
                      {new Date(v.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-muted-foreground">
                      {v.endpoint_url ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
                          <Activity className="h-3 w-3" /> Ready
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">-</span>
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
