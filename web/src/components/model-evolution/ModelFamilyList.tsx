import type { RegistryFamily } from '../../types/modelApi';
import { Box, CheckCircle } from 'lucide-react';

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

interface Props {
  families: RegistryFamily[];
  loading: boolean;
  selectedFamilyId?: number;
  onSelect: (family: RegistryFamily) => void;
}

export function ModelFamilyList({ families, loading, selectedFamilyId, onSelect }: Props) {
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
      <div className="p-6 text-center text-gray-500 text-sm">
        No model families found in the registry.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {families.map(family => {
        const isSelected = family.id === selectedFamilyId;
        const hasProd = !!family.current_production_version;
        
        return (
          <button
            key={family.id}
            onClick={() => onSelect(family)}
            className={classNames(
              'w-full text-left p-3 rounded-xl border flex items-center gap-3 transition-colors duration-200',
              isSelected 
                ? 'bg-blue-50 border-blue-200 shadow-sm' 
                : 'bg-white border-transparent hover:bg-gray-50 hover:border-gray-200'
            )}
          >
            <div className={classNames(
              'p-2 rounded-lg',
              isSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            )}>
              <Box className="h-5 w-5" />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">
                {family.display_name || family.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {hasProd && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                    <CheckCircle className="h-3 w-3" /> Prod Active
                  </span>
                )}
                {!hasProd && (
                  <span className="text-[11px] text-gray-500 font-medium">No Production</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
