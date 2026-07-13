import type { RegistryFamily } from '@/features/registry/types';
import { Box, CheckCircle } from 'lucide-react';

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

interface Props {
  families: RegistryFamily[];
  loading: boolean;
  selectedFamilyId?: string;
  selectedFamilyVersionCount?: number;
  onSelect: (family: RegistryFamily) => void;
}

import { formatVersion } from '@/shared/lib/formatters';

export function ModelFamilyList({ families, loading, selectedFamilyId, selectedFamilyVersionCount, onSelect }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (families.length === 0) {
    return (
      <div className="p-8 text-center flex flex-col items-center">
        <div className="bg-muted p-3 rounded-full mb-3">
          <Box className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-bold text-foreground">No Model Families</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-[200px]">
          Upload a model to create your first registry family.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {families.map(family => {
        const isSelected = family.id === selectedFamilyId;
        const hasProd = !!family.current_production_version;
        const actualVersionCount = isSelected && selectedFamilyVersionCount !== undefined 
          ? selectedFamilyVersionCount 
          : (family.version_count || 0);
        
        const finalCount = (actualVersionCount === 0 && hasProd) ? 1 : actualVersionCount;
        const isEndpointReady = hasProd && !!family.current_production_version?.endpoint_url;
        
        return (
          <button
            key={family.id}
            onClick={() => onSelect(family)}
            className={classNames(
              'w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-all duration-200 group',
              isSelected 
                ? 'bg-primary-subtle border-primary/20 relative overflow-hidden'
                : 'bg-surface border-transparent hover:bg-muted hover:border-border'
            )}
          >
            {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-xl" />}
            <div className={classNames(
              'p-2 rounded-lg mt-0.5 transition-colors',
              isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground group-hover:text-muted-foreground'
            )}>
              <Box className="h-5 w-5" />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex justify-between items-start gap-2">
                <p className={classNames(
                  "text-sm font-bold truncate",
                  isSelected ? "text-primary" : "text-foreground"
                )}>
                  {family.display_name || family.name}
                </p>
                {hasProd && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-success bg-success-subtle px-1.5 py-0.5 rounded">
                    <CheckCircle className="h-3 w-3" /> Prod
                  </span>
                )}
              </div>
              
              <div className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground">
                {hasProd ? (
                  <span className="text-foreground font-bold">Prod {formatVersion(family.current_production_version?.version)}</span>
                ) : (
                  <span>No production version</span>
                )}
                <span>&middot;</span>
                <span>{finalCount} {finalCount === 1 ? 'version' : 'versions'}</span>
              </div>
              
              <div className="text-[10px] text-muted-foreground flex items-center justify-between mt-0.5">
                <span className="truncate">Updated {new Date(family.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                {isEndpointReady && (
                  <span className="text-success font-semibold tracking-wide uppercase">Endpoint Ready</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
