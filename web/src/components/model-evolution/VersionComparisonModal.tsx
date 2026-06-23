import { useState, useEffect } from 'react';
import { X, GitCompare } from 'lucide-react';
import { Button } from './../ui/Button';
import type { RegistryFamily, RegistryVersion, RegistryMetric } from '../../types/modelApi';
import { getRegistryMetrics } from '../../lib/api';
import { formatVersion } from '../../lib/formatters';

interface Props {
  family: RegistryFamily;
  versions: RegistryVersion[];
  onClose: () => void;
}

export function VersionComparisonModal({ family, versions, onClose }: Props) {
  const [v1Id, setV1Id] = useState<number>(versions[0]?.id);
  const [v2Id, setV2Id] = useState<number>(versions[1]?.id || versions[0]?.id);
  
  const [metrics1, setMetrics1] = useState<Record<string, RegistryMetric[]>>({});
  const [metrics2, setMetrics2] = useState<Record<string, RegistryMetric[]>>({});
  
  const v1 = versions.find(v => v.id === v1Id);
  const v2 = versions.find(v => v.id === v2Id);

  useEffect(() => {
    if (v1Id) {
      void getRegistryMetrics(family.id, v1Id).then(setMetrics1).catch(() => setMetrics1({}));
    }
  }, [family.id, v1Id]);

  useEffect(() => {
    if (v2Id) {
      void getRegistryMetrics(family.id, v2Id).then(setMetrics2).catch(() => setMetrics2({}));
    }
  }, [family.id, v2Id]);

  const getLatestMetricValue = (metrics: Record<string, RegistryMetric[]>, name: string) => {
    const arr = metrics[name];
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a.step - b.step);
    return sorted[sorted.length - 1].value;
  };

  const formatMetric = (val: number | null) => {
    if (val === null) return 'N/A';
    return Number.isInteger(val) ? val.toString() : val.toFixed(4);
  };

  const renderDelta = (val1: number | null, val2: number | null) => {
    if (val1 === null || val2 === null) return null;
    const delta = val2 - val1;
    if (delta === 0) return <span className="text-gray-400 text-xs ml-2">(0)</span>;
    const isPositive = delta > 0;
    const color = isPositive ? 'text-emerald-600' : 'text-red-600';
    const sign = isPositive ? '+' : '';
    return <span className={`${color} text-xs ml-2 font-bold bg-white px-1.5 py-0.5 rounded border border-gray-100`}>({sign}{Number.isInteger(delta) ? delta : delta.toFixed(4)})</span>;
  };

  const allMetricNames = Array.from(new Set([...Object.keys(metrics1), ...Object.keys(metrics2)]));

  if (versions.length < 2) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-center p-8">
          <div className="mx-auto bg-gray-50 rounded-full w-16 h-16 flex items-center justify-center mb-4">
            <GitCompare className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Not Enough Versions</h3>
          <p className="text-sm text-gray-500 mb-6">
            Add another version to compare model evolution.
          </p>
          <Button variant="primary" onClick={onClose} className="w-full justify-center">Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 text-blue-600 p-2 rounded-lg">
              <GitCompare className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Compare Versions</h2>
              <p className="text-sm text-gray-500">Family: {family.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-full hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          <div className="grid grid-cols-3 gap-4 mb-6 sticky top-0 bg-gray-50/90 backdrop-blur-md py-4 border-b border-gray-200 z-10">
            <div className="font-bold text-gray-500 uppercase tracking-wider flex items-center pl-4">Attribute</div>
            <div>
              <select 
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500"
                value={v1Id}
                onChange={(e) => setV1Id(Number(e.target.value))}
              >
                {versions.map(v => (
                  <option key={v.id} value={v.id}>Version {formatVersion(v.version)} {v.stage === 'production' ? '(Prod)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <select 
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500"
                value={v2Id}
                onChange={(e) => setV2Id(Number(e.target.value))}
              >
                {versions.map(v => (
                  <option key={v.id} value={v.id}>Version {formatVersion(v.version)} {v.stage === 'production' ? '(Prod)' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm text-left">
              <tbody className="divide-y divide-gray-100">
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-700 w-1/4 uppercase tracking-wider text-xs">Stage</td>
                  <td className="px-6 py-4 w-3/8">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${v1?.stage === 'production' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
                      {v1?.stage}
                    </span>
                  </td>
                  <td className="px-6 py-4 w-3/8 border-l border-gray-100 bg-gray-50/30">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${v2?.stage === 'production' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
                      {v2?.stage}
                    </span>
                  </td>
                </tr>
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-700 w-1/4 uppercase tracking-wider text-xs border-r border-gray-100">Source</td>
                  <td className="px-6 py-4 text-gray-600 font-medium border-r border-gray-100">
                    {v1?.source_type.replace('_', ' ')} {v1?.source_training_job_id ? `(#${v1.source_training_job_id})` : ''}
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-medium bg-gray-50/30">
                    {v2?.source_type.replace('_', ' ')} {v2?.source_training_job_id ? `(#${v2.source_training_job_id})` : ''}
                  </td>
                </tr>
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-700 uppercase tracking-wider text-xs">Created</td>
                  <td className="px-6 py-4 text-gray-600 font-medium">{v1 ? new Date(v1.created_at).toLocaleString() : ''}</td>
                  <td className="px-6 py-4 text-gray-600 font-medium border-l border-gray-100 bg-gray-50/30">{v2 ? new Date(v2.created_at).toLocaleString() : ''}</td>
                </tr>
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-700 uppercase tracking-wider text-xs">Endpoint Ready</td>
                  <td className="px-6 py-4 text-gray-600 font-medium">
                    {v1?.endpoint_url ? <span className="text-emerald-600 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-medium border-l border-gray-100 bg-gray-50/30">
                    {v2?.endpoint_url ? <span className="text-emerald-600 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
                  </td>
                </tr>
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-700 uppercase tracking-wider text-xs">Image Name</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-xs break-all">{v1?.image_name || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-xs break-all border-l border-gray-100 bg-gray-50/30">{v2?.image_name || '-'}</td>
                </tr>
                
                {/* Metrics */}
                {allMetricNames.length > 0 && (
                  <tr className="bg-blue-50/50 border-y border-blue-100">
                    <td colSpan={3} className="px-6 py-3 font-extrabold text-blue-900 uppercase tracking-wider text-xs">
                      Latest Metrics Comparison
                    </td>
                  </tr>
                )}
                
                {allMetricNames.length === 0 && (
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-bold text-gray-700 uppercase tracking-wider text-xs">Metrics</td>
                    <td colSpan={2} className="px-6 py-4 text-gray-400 italic">No metrics parsed for these versions.</td>
                  </tr>
                )}

                {allMetricNames.map(name => {
                  const m1 = getLatestMetricValue(metrics1, name);
                  const m2 = getLatestMetricValue(metrics2, name);
                  return (
                    <tr key={name} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-6 py-4 font-bold text-gray-700 capitalize text-sm">{name.replace(/_/g, ' ')}</td>
                      <td className="px-6 py-4 font-mono text-gray-900 font-bold text-lg">{formatMetric(m1)}</td>
                      <td className="px-6 py-4 font-mono text-gray-900 font-bold text-lg border-l border-gray-100 bg-gray-50/30 flex items-center group-hover:bg-white transition-colors">
                        {formatMetric(m2)}
                        {renderDelta(m1, m2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
