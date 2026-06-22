/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { getRegistryHistory } from '../../lib/api';
import type { RegistryHistory } from '../../types/modelApi';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { GitCommit, ArrowUpRight, RotateCcw, Package, CheckCircle, XCircle, Trash2, Activity } from 'lucide-react';

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

interface Props {
  familyId: number;
}

export function ModelHistoryTimeline({ familyId }: Props) {
  const [history, setHistory] = useState<RegistryHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getRegistryHistory(familyId);
      setHistory(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to fetch model history.'));
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No history events found for this model family.
      </div>
    );
  }

  return (
    <div className="relative border-l border-gray-200 ml-3 py-4 space-y-8">
      {history.map((event, idx) => {
        const isSuccess = event.status === 'success';
        const isFailed = event.status === 'failed';
        
        let Icon = GitCommit;
        let iconBg = 'bg-gray-100 text-gray-500 border-gray-200';

        // Action-based styling
        if (event.action === 'promoted') {
          Icon = ArrowUpRight;
          iconBg = 'bg-emerald-100 text-emerald-600 border-emerald-200';
        } else if (event.action === 'rolled_back') {
          Icon = RotateCcw;
          iconBg = 'bg-amber-100 text-amber-600 border-amber-200';
        } else if (event.action === 'registered') {
          Icon = Package;
          iconBg = 'bg-blue-100 text-blue-600 border-blue-200';
        } else if (event.action === 'health_checked') {
          Icon = Activity;
          iconBg = 'bg-purple-100 text-purple-600 border-purple-200';
        } else if (event.action === 'archived' || event.action === 'stopped') {
          Icon = Trash2;
          iconBg = 'bg-gray-100 text-gray-500 border-gray-200';
        }

        // Status overrides
        if (isFailed) {
          Icon = XCircle;
          iconBg = 'bg-red-100 text-red-600 border-red-200';
        } else if (event.action === 'deployed' && isSuccess) {
          Icon = CheckCircle;
          iconBg = 'bg-emerald-100 text-emerald-600 border-emerald-200';
        }

        return (
          <div key={event.id || idx} className="relative pl-8">
            <span 
              className={classNames(
                "absolute -left-4 top-1 flex h-8 w-8 items-center justify-center rounded-full border ring-4 ring-white",
                iconBg
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-900 capitalize">{event.action.replace('_', ' ')}</span>
                <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">v{event.version}</span>
                {event.from_stage && event.to_stage && (
                  <span className="text-xs text-gray-500">
                    {event.from_stage} &rarr; {event.to_stage}
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {event.message}
              </p>
              {event.actor && (
                <p className="text-xs text-gray-400">
                  By: {event.actor}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
