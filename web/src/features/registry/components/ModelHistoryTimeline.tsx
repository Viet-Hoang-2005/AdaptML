/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { getRegistryHistory } from '@/features/registry/api/registryApi';
import { formatVersion } from '@/shared/lib/formatters';
import type { RegistryHistory } from '@/features/registry/types';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import { GitCommit, ArrowUpRight, RotateCcw, Package, CheckCircle, XCircle, Trash2, Activity } from 'lucide-react';

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

interface Props {
  familyId: string;
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
      <div className="text-center py-16 flex flex-col items-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50 px-4">
        <div className="rounded-full bg-white border border-gray-200 p-4 mb-4 shadow-sm">
          <GitCommit className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-bold text-gray-900">No registry events yet</h3>
        <p className="mt-2 text-sm text-gray-500 max-w-md">
          Events will appear here when versions are registered, deployed, promoted, or rolled back.
        </p>
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

        let actionText = event.action.replace('_', ' ');
        if (event.action === 'registered') actionText = 'Registered version';
        else if (event.action === 'built') actionText = 'Build completed';
        else if (event.action === 'deployed') actionText = 'Endpoint deployed';
        else if (event.action === 'promoted') actionText = 'Promoted to production';
        else if (event.action === 'rolled_back') actionText = `Rolled back to ${formatVersion(event.version)}`;
        else if (event.action === 'stopped') actionText = 'Endpoint stopped';
        
        if (isFailed) actionText = 'Operation failed';

        const renderTransition = () => {
          if (!event.from_stage && !event.to_stage) return null;

          if (event.action === 'promoted' || event.action === 'rolled_back') {
            const from = !event.from_stage || event.from_stage === 'none' ? 'No production' : formatVersion(event.from_stage);
            const to = event.to_stage && event.to_stage !== 'production' ? formatVersion(event.to_stage) : formatVersion(event.version);
            
            if (from === 'No production') {
              return (
                <span className="text-xs text-gray-500 font-medium">
                  Previous: <span className="font-semibold text-gray-600">No production</span> &rarr; Current: <span className="font-mono font-semibold text-gray-800">{to}</span>
                </span>
              );
            }
            return (
              <span className="text-xs text-gray-500 font-medium">
                <span className="font-mono font-semibold text-gray-600">{from}</span> &rarr; <span className="font-mono font-semibold text-gray-800">{to}</span>
              </span>
            );
          }

          return (
            <span className="text-xs text-gray-500 font-medium">
              {event.from_stage} &rarr; {event.to_stage}
            </span>
          );
        };

        return (
          <div key={event.id || idx} className="relative pl-8">
            <span 
              className={classNames(
                "absolute -left-4 top-1 flex h-8 w-8 items-center justify-center rounded-full border ring-4 ring-white shadow-sm",
                iconBg
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-900">{actionText}</span>
                <span className="text-xs font-mono font-semibold bg-gray-100 border border-gray-200 px-2 py-0.5 rounded text-gray-700">{formatVersion(event.version)}</span>
                {renderTransition()}
                <span className="text-xs font-medium text-gray-400 ml-auto">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
              
              {event.action === 'promoted' || event.action === 'rolled_back' ? (
                <p className="text-sm text-gray-600">Registry production marker updated.</p>
              ) : (
                <p className="text-sm text-gray-600">{event.message}</p>
              )}
              
              {event.actor && (
                <p className="text-xs font-medium text-gray-400">
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
