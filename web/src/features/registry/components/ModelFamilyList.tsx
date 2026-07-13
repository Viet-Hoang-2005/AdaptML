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
          <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (families.length === 0) {
    return (
      <div className="p-8 text-center flex flex-col items-center">
        <div className="bg-gray-100 p-3 rounded-full mb-3">
          <Box className="h-6 w-6 text-gray-400" />
        </div>
        <p className="text-sm font-bold text-gray-900">No Model Families</p>
        <p className="mt-1 text-xs text-gray-500 max-w-[200px]">
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
                ? 'bg-blue-50/60 border-blue-200 shadow-sm relative overflow-hidden' 
                : 'bg-white border-transparent hover:bg-gray-50 hover:border-gray-200'
            )}
          >
            {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-xl" />}
            <div className={classNames(
              'p-2 rounded-lg mt-0.5 transition-colors',
              isSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400 group-hover:text-gray-600'
            )}>
              <Box className="h-5 w-5" />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex justify-between items-start gap-2">
                <p className={classNames(
                  "text-sm font-bold truncate",
                  isSelected ? "text-blue-900" : "text-gray-900"
                )}>
                  {family.display_name || family.name}
                </p>
                {hasProd && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shadow-sm">
                    <CheckCircle className="h-3 w-3" /> Prod
                  </span>
                )}
              </div>
              
              <div className="text-[11px] font-medium flex items-center gap-1.5 text-gray-500">
                {hasProd ? (
                  <span className="text-gray-700 font-bold">Prod {formatVersion(family.current_production_version?.version)}</span>
                ) : (
                  <span>No production version</span>
                )}
                <span>&middot;</span>
                <span>{finalCount} {finalCount === 1 ? 'version' : 'versions'}</span>
              </div>
              
              <div className="text-[10px] text-gray-400 flex items-center justify-between mt-0.5">
                <span className="truncate">Updated {new Date(family.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                {isEndpointReady && (
                  <span className="text-emerald-600 font-semibold tracking-wide uppercase">Endpoint Ready</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
