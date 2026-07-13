import { Edit3, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/shared/ui/Button';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { ApiModal } from '@/features/settings/components/ApiModal';
import { useDeveloperSettings } from '@/features/settings/hooks/useDeveloperSettings';
import { useModelProjects } from '@/features/catalog/hooks/useModelProjects';
import type { APIKeyRecord } from '@/features/settings/types';
import { PageContent } from '@/shared/ui/PageContent';
import { DataTable } from '@/shared/ui/DataTable';
import { IconButton } from '@/shared/ui/IconButton';
import { Badge } from '@/shared/ui/Badge';

export default function DeveloperSettingPage() {
  const navigate = useNavigate();
  const { data: modelsData } = useModelProjects();
  const models = modelsData?.models ?? [];
  const modelIdToName = Object.fromEntries(models.map(m => [m.id, m.name]));

  const {
    apiKeys,
    loading,
    createdApiKey,
    setCreatedApiKey,
    handleDeleteAPIKey,
    handleRegenerateAPIKey,
    handleCopyCreatedKey,
  } = useDeveloperSettings();

  const handleDone = () => setCreatedApiKey(null);
  const [pendingAction, setPendingAction] = useState<{ kind: 'regenerate' | 'delete'; key: APIKeyRecord } | null>(null);

  const columns: ColumnDef<APIKeyRecord>[] = [
    {
      id: 'index',
      header: '#',
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{row.index + 1}</span>,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-semibold text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-sm text-sm text-muted-foreground">
          {row.original.description || 'No description provided.'}
        </span>
      ),
    },
    {
      id: 'models',
      header: 'Model scope',
      enableSorting: false,
      cell: ({ row }) => {
        const record = row.original;
        const scope = record.scope;
        if (scope === 'all') {
          return <Badge variant="primary">All models</Badge>;
        }
        if (!record.allowed_models || record.allowed_models.length === 0) {
          return <Badge variant="danger">No models</Badge>;
        }
        return (
          <div className="flex max-w-xs flex-wrap gap-1">
            {record.allowed_models.map(id => (
              <Badge key={id}>{modelIdToName[id] || `Unknown (${id})`}</Badge>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{new Date(row.original.created_at).toLocaleString()}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const record = row.original;
        return (
        <div className="flex items-center gap-1">
          <IconButton
            label="Edit API key"
            icon={<Edit3 className="h-4 w-4" />}
            onClick={() => navigate(`/dashboard/settings/developer/api-keys/${record.id}`)}
          />
          <IconButton label="Regenerate API key" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setPendingAction({ kind: 'regenerate', key: record })} />
          <IconButton label="Delete API key" variant="danger-outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => setPendingAction({ kind: 'delete', key: record })} />
        </div>
      );
      },
    },
  ];

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <PageContent>
        <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Developer Access</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create and manage API keys for private model endpoint authentication.
            </p>
          </div>
          <Button
            id="btn-create-api-key"
            size='md'
            icon={<KeyRound className="h-4 w-4" />}
            onClick={() => navigate('/dashboard/settings/developer/api-keys/create')}
          >
            Create API Key
          </Button>
        </div>

        <div className="px-6 py-6">
          <DataTable columns={columns} data={apiKeys} getRowId={(key) => key.id} loading={loading} pageSize={10} emptyMessage="No API keys yet." />
        </div>
      </PageContent>

      {createdApiKey && (
        <ApiModal
          title="API Key Regenerated"
          description="This new key is shown once. Store it now before closing this modal. The old key will no longer work."
          apiKey={createdApiKey.api_key}
          onClose={handleDone}
          onCopy={handleCopyCreatedKey}
        />
      )}
      <ConfirmModal
        open={Boolean(pendingAction)}
        title={pendingAction?.kind === 'delete' ? 'Delete API key' : 'Regenerate API key'}
        description={pendingAction?.kind === 'delete'
          ? `Delete “${pendingAction.key.name}”? Applications using this key will immediately lose access.`
          : `Regenerate “${pendingAction?.key.name}”? The existing key will stop working immediately.`}
        confirmText={pendingAction?.kind === 'delete' ? 'Delete key' : 'Regenerate key'}
        tone={pendingAction?.kind === 'delete' ? 'danger' : 'default'}
        onConfirm={() => {
          if (pendingAction?.kind === 'delete') void handleDeleteAPIKey(pendingAction.key);
          if (pendingAction?.kind === 'regenerate') void handleRegenerateAPIKey(pendingAction.key);
          setPendingAction(null);
        }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
