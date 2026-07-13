/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getRegistryMetrics } from '@/features/registry/api/registryApi';
import type { RegistryMetric } from '@/features/registry/types';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import { BarChart2 } from 'lucide-react';

interface Props {
  familyId: string;
  versionId: string;
}

export function ModelMetricsPanel({ familyId, versionId }: Props) {
  const [metrics, setMetrics] = useState<Record<string, RegistryMetric[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getRegistryMetrics(familyId, versionId);
      setMetrics(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to fetch model metrics.'));
    } finally {
      setLoading(false);
    }
  }, [familyId, versionId]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  // Compute stats for rendering
  const metricEntries = useMemo(() => {
    return Object.entries(metrics).map(([name, dataPoints]) => {
      if (dataPoints.length === 0) return null;
      
      const sorted = [...dataPoints].sort((a, b) => a.step - b.step);
      const latest = sorted[sorted.length - 1];
      const values = sorted.map(d => d.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      // Calculate height percentages for the mini chart
      // We add a tiny buffer so lines don't hit the absolute top/bottom unless it's exactly 0/100
      const range = max - min || 1;
      const chartPoints = sorted.map(d => ({
        ...d,
        heightPct: Math.max(5, ((d.value - min) / range) * 100)
      }));

      return {
        name,
        latest,
        min,
        max,
        chartPoints,
      };
    }).filter(Boolean);
  }, [metrics]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (metricEntries.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50 px-6 max-w-3xl mx-auto">
        <div className="rounded-full bg-white border border-gray-200 p-4 mb-4 shadow-sm">
          <BarChart2 className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">No Metric History Found</h3>
        <p className="text-sm text-gray-600 max-w-lg mb-6">
          Summary metrics are shown above when training artifacts include metrics.json. This panel is reserved for structured metric records across training steps.
        </p>
        
        <div className="text-left bg-[#1e1e1e] rounded-lg overflow-hidden w-full shadow-sm border border-gray-800 mb-4">
          <div className="bg-[#2d2d2d] px-3 py-1.5 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-500"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-gray-500"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-gray-500"></div>
              </div>
              <span className="text-xs font-mono text-gray-400">train.py - metric output contract</span>
            </div>
            <button 
              className="text-xs text-gray-400 hover:text-white transition-colors"
              onClick={() => {
                navigator.clipboard.writeText('import json\n\n# METRIC_JSON stdout works without extra dependencies.\nprint("METRIC_JSON:", json.dumps({\n    "step": 1,\n    "accuracy": 0.95,\n    "loss": 0.12,\n    "f1": 0.93\n}))');
                toast.success('Snippet copied to clipboard');
              }}
            >
              Copy
            </button>
          </div>
          <div className="p-4">
            <pre className="text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed">
              <code>{`import json

# METRIC_JSON stdout works without extra dependencies.
print("METRIC_JSON:", json.dumps({
    "step": 1,
    "accuracy": 0.95,
    "loss": 0.12,
    "f1": 0.93
}))`}</code>
            </pre>
          </div>
        </div>

        <p className="text-xs font-medium text-gray-500">
          Metrics appear here after the training job completes and registry data is synced.
        </p>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      
      {/* Metric Cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {metricEntries.map((m) => {
          if (!m) return null;
          return (
            <div key={`card-${m.name}`} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 truncate" title={m.name}>
                {m.name.replace(/_/g, ' ')}
              </p>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  {Number.isInteger(m.latest.value) ? m.latest.value : m.latest.value.toFixed(4)}
                </span>
                <span className="text-xs text-gray-500 mb-1">Step {m.latest.step}</span>
              </div>
              <p className="text-[10px] text-gray-400 uppercase mt-2">Source: {m.latest.source}</p>
            </div>
          );
        })}
      </div>

      {/* Lightweight SVG Charts & Trend Table */}
      <div className="grid lg:grid-cols-2 gap-6">
        {metricEntries.map((m) => {
          if (!m) return null;
          
          // Generate SVG polyline points
          const width = 300;
          const height = 100;
          const points = m.chartPoints.map((point, idx) => {
            const x = (idx / Math.max(1, m.chartPoints.length - 1)) * width;
            const y = height - (point.heightPct / 100) * height;
            return `${x},${y}`;
          }).join(' ');

          const last5 = [...m.chartPoints].reverse().slice(0, 5);

          return (
            <div key={`chart-${m.name}`} className="border border-gray-200 bg-white shadow-sm rounded-2xl p-5">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-bold text-gray-900 capitalize">{m.name.replace(/_/g, ' ')} Progression</h4>
                <span className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded">Min: {m.min.toFixed(2)} | Max: {m.max.toFixed(2)}</span>
              </div>
              
              <div className="w-full bg-gray-50 rounded-xl p-4 border border-gray-100 flex flex-col gap-2">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 overflow-visible stroke-blue-500 fill-none" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={`grad-${m.name}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Fill Area */}
                  <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#grad-${m.name})`} className="stroke-none" />
                  {/* Line */}
                  <polyline points={points} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {/* Points */}
                  {m.chartPoints.map((point, idx) => {
                    const x = (idx / Math.max(1, m.chartPoints.length - 1)) * width;
                    const y = height - (point.heightPct / 100) * height;
                    return (
                      <circle key={idx} cx={x} cy={y} r="3" className="fill-white stroke-blue-600 stroke-2" />
                    );
                  })}
                </svg>
                <div className="flex justify-between text-xs text-gray-400 font-mono px-1">
                  <span>Step {m.chartPoints[0].step}</span>
                  <span>Step {m.latest.step}</span>
                </div>
              </div>

              {/* Trend Table */}
              <div className="mt-6">
                <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Recent Trend (Last 5)</h5>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-semibold">
                      <tr>
                        <th className="px-3 py-2">Step</th>
                        <th className="px-3 py-2 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {last5.map((point) => (
                        <tr key={point.step} className="bg-white">
                          <td className="px-3 py-2 font-mono text-gray-500">{point.step}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-900">
                            {Number.isInteger(point.value) ? point.value : point.value.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

