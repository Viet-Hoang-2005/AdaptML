import type { RegistryFamily, RegistryVersion } from '../../types/modelApi';
import { Layers, Star, Info, FileCode2 } from 'lucide-react';

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

interface Props {
  family: RegistryFamily;
  versions: RegistryVersion[];
  loading: boolean;
  selectedVersionId?: number;
  onSelectVersion: (v: RegistryVersion) => void;
}

export function ModelFamilyDetail({ family, versions, loading, selectedVersionId, onSelectVersion }: Props) {
  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 p-5 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-gray-900">{family.display_name || family.name}</h2>
            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-mono">ID: {family.id}</span>
          </div>
          <p className="text-sm text-gray-500 max-w-2xl">{family.description || 'No description provided.'}</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex flex-col items-end">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Versions</span>
            <span className="font-bold text-gray-900">{versions.length}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Prod Version</span>
            <span className="font-bold text-gray-900">
              {family.current_production_version ? family.current_production_version.version : 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* Version Table */}
      <div className="p-0 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-white">
            <tr>
              <th scope="col" className="py-3.5 pl-5 pr-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Version</th>
              <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stage</th>
              <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
              <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {loading ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-sm text-gray-500">
                  <div className="flex justify-center mb-2">
                    <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  Loading versions...
                </td>
              </tr>
            ) : versions.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-sm text-gray-500">
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
                      <span className="font-mono">{v.version}</span>
                      {isProd && <Star className="h-4 w-4 text-amber-400 fill-amber-400 ml-1" />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      <span className={classNames(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                        v.stage === 'production' ? "bg-emerald-100 text-emerald-800" :
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
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {new Date(v.updated_at).toLocaleDateString()}
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
