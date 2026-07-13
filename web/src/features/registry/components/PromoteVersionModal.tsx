import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { toast } from '@/shared/ui/toastStore';
import { promoteRegistryVersion } from '@/features/registry/api/registryApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import type { RegistryFamily, RegistryVersion, RoutingAliasName } from '@/features/registry/types';
import { AlertCircle, ArrowUpCircle } from 'lucide-react';
import { formatVersion } from '@/shared/lib/formatters';

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  onClose: () => void;
  onSuccess: () => void;
}

export function PromoteVersionModal({ family, version, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [alias, setAlias] = useState<RoutingAliasName>('production');

  const handlePromote = async () => {
    try {
      setLoading(true);
      const result = await promoteRegistryVersion(family.id, version.id, alias);
      toast.success(result.message || `Version ${formatVersion(version.version)} promoted to ${alias}.`);
      if (result.warning) {
        toast.warning(result.warning);
      }
      onSuccess();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to promote version. Please try again.'));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-emerald-100 text-emerald-600 p-2.5 rounded-full">
              <ArrowUpCircle className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground">Promote to Alias</h3>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 text-blue-800 shadow-sm">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-blue-600" />
            <p className="text-sm">
              Promote this version to a stable routing alias. Clients can call the alias endpoint without changing URLs when the target version changes.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 text-sm bg-muted p-4 rounded-xl border border-border">
            <label className="flex flex-col gap-2 pb-2 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">Alias</span>
              <select
                value={alias}
                onChange={(event) => setAlias(event.target.value as RoutingAliasName)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                disabled={loading}
              >
                <option value="production">Production</option>
                <option value="latest">Latest</option>
                <option value="champion">Champion</option>
              </select>
            </label>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">Target Version</span>
              <span className="font-bold font-mono text-emerald-700 bg-emerald-100 px-2 rounded">{formatVersion(version.version)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">Current Prod</span>
              <span className="font-mono text-muted-foreground">
                {family.current_production_version ? formatVersion(family.current_production_version.version) : 'None'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">Family</span>
              <span className="font-bold text-foreground">{family.display_name || family.name}</span>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-muted border-t border-border flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <button 
            onClick={() => void handlePromote()} 
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {loading ? 'Promoting...' : `Promote to ${alias}`}
          </button>
        </div>
      </div>
    </div>
  );
}
