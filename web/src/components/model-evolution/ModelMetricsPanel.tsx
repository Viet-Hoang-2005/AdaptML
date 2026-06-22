/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getRegistryMetrics } from '../../lib/api';
import type { RegistryMetric } from '../../types/modelApi';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { BarChart2 } from 'lucide-react';

interface Props {
  familyId: number;
  versionId: number;
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
      <div className="text-center py-16 flex flex-col items-center">
        <div className="rounded-full bg-gray-50 p-4 mb-4">
          <BarChart2 className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-sm font-bold text-gray-900">No Structured Metrics Found</h3>
        <p className="mt-1 text-sm text-gray-500 max-w-sm">
          Metrics parsed from training logs or evaluations will appear here. Ensure your training job outputs METRIC_JSON format.
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

      {/* Lightweight Bar Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {metricEntries.map((m) => {
          if (!m) return null;
          return (
            <div key={`chart-${m.name}`} className="border border-gray-200 rounded-xl p-5">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-bold text-gray-900 capitalize">{m.name.replace(/_/g, ' ')} Progression</h4>
                <span className="text-xs text-gray-500 font-mono">Min: {m.min.toFixed(2)} | Max: {m.max.toFixed(2)}</span>
              </div>
              
              <div className="h-32 flex items-end gap-1 w-full bg-gray-50/50 rounded p-2 border border-gray-100">
                {m.chartPoints.map((point, idx) => (
                  <div 
                    key={idx} 
                    className="flex-1 bg-blue-400 hover:bg-blue-600 rounded-t transition-colors relative group"
                    style={{ height: `${point.heightPct}%` }}
                  >
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                      Step {point.step}: {point.value.toFixed(4)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-2 font-mono">
                <span>Step {m.chartPoints[0].step}</span>
                <span>Step {m.latest.step}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
