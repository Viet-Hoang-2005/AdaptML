import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { promoteRegistryVersion } from '../../lib/api';
import type { RegistryFamily, RegistryVersion } from '../../types/modelApi';
import { AlertCircle } from 'lucide-react';

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  onClose: () => void;
  onSuccess: () => void;
}

export function PromoteVersionModal({ family, version, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);

  const handlePromote = async () => {
    try {
      setLoading(true);
      await promoteRegistryVersion(family.id, version.id);
      toast.success(`Version ${version.version} successfully promoted to production.`);
      onSuccess();
    } catch {
      toast.error('Failed to promote version. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-900">Promote to Production</h3>
          
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-amber-800">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">
              Promoting this version marks it as the production version in the registry. 
              <strong> It does not change live endpoint routing yet.</strong>
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Target Version:</span>
              <span className="font-bold font-mono text-gray-900">{version.version}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Current Production:</span>
              <span className="font-mono text-gray-900">
                {family.current_production_version ? family.current_production_version.version : 'None'}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-500">Family:</span>
              <span className="font-bold text-gray-900">{family.display_name || family.name}</span>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handlePromote()} disabled={loading}>
            {loading ? 'Promoting...' : 'Promote version'}
          </Button>
        </div>
      </div>
    </div>
  );
}
