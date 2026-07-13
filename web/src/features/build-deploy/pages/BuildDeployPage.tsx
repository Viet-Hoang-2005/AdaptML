import { useState } from 'react';
import { Bot, Edit3, Trash2, Search, Plus, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { DataTable } from '@/shared/ui/DataTable';
import { IconButton } from '@/shared/ui/IconButton';
import { Badge } from '@/shared/ui/Badge';
import Placeholder from '@/features/catalog/components/ModelPlaceholder';
import { useModelProjects, useModelProjectMutations } from '@/features/catalog/hooks/useModelProjects';
import type { ModelProject } from '@/features/catalog/types';
import EditModelModal from '@/features/build-deploy/components/EditModelModal';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageContent } from '@/shared/ui/PageContent';

export default function APIManagementPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useModelProjects();
  const { deleteModelProject } = useModelProjectMutations();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelProject | null>(null);
  const [modelToDelete, setModelToDelete] = useState<ModelProject | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  
  const models = data?.models ?? [];
  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const columns: ColumnDef<ModelProject>[] = [
    {
      id: 'index',
      header: '#',
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{row.index + 1}</span>,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <button
          type="button"
          className="font-semibold text-foreground hover:text-primary"
          onClick={() => navigate(`/dashboard/api-management/${row.original.id}`)}
        >
          {row.original.name}
        </button>
      ),
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
      accessorKey: 'flavor',
      header: 'Flavor',
      cell: ({ row }) => <Badge>{row.original.flavor || 'Not set'}</Badge>,
    },
    {
      accessorKey: 'access_mode',
      header: 'Access',
      cell: ({ row }) => <Badge variant={row.original.access_mode === 'public' ? 'success' : 'neutral'}>{row.original.access_mode}</Badge>,
    },
    {
      accessorKey: 'updated_at',
      header: 'Updated',
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{new Date(row.original.updated_at).toLocaleString()}</span>,
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
            label="Download model"
            icon={<Download className="h-4 w-4" />}
            onClick={() => {
              if (record.model_uri) window.open(record.model_uri, '_blank', 'noopener,noreferrer');
            }}
            disabled={!record.model_uri}
          />
          <IconButton
            label="Edit model"
            icon={<Edit3 className="h-4 w-4" />}
            onClick={() => {
              setSelectedModel(record);
              setIsModalVisible(true);
            }}
          />
          <IconButton label="Delete model" variant="danger-outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => setModelToDelete(record)} />
        </div>
      );
      },
    },
  ];

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <PageHeader title="Management" />

      <PageContent>
        <div className="px-6 py-6 space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:w-96">
              <Input
                placeholder="Search model by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="h-4 w-4" />}
                className="h-10! rounded-lg!"
              />
            </div>
            <Button
              size="md"
              onClick={() => navigate('/dashboard/api-management/upload')}
            >
              <Plus className="h-4 w-4"/>
              Upload model
            </Button>
          </div>

          <div>
            {isLoading ? (
              <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
                Loading models...
              </div>
            ) : filteredModels.length === 0 ? (
              <Placeholder
                title="No models found"
                description={searchQuery ? `No models matching "${searchQuery}"` : "Upload your first MLflow model package to create a prediction endpoint."}
                icon={<Bot className="h-6 w-6" />}
                showModelName={false}
                action={!searchQuery && <Button size="md" onClick={() => navigate('/dashboard/api-management/upload')}>Upload model</Button>}
              />
            ) : (
              <DataTable columns={columns} data={filteredModels} getRowId={(model) => model.id} pageSize={10} />
            )}
          </div>
        </div>
      </PageContent>
      
      <EditModelModal
        key={`edit-modal-${selectedModel?.id || 'none'}-${isModalVisible}`}
        model={selectedModel}
        visible={isModalVisible}
        onClose={() => {
          setIsModalVisible(false);
          setSelectedModel(null);
        }}
      />
      <ConfirmModal
        open={Boolean(modelToDelete)}
        title="Delete model API"
        description={<>Delete <strong>{modelToDelete?.name}</strong>? This action cannot be undone.</>}
        confirmText="Delete model"
        tone="danger"
        onConfirm={() => {
          if (modelToDelete) void deleteModelProject(modelToDelete.id);
          setModelToDelete(null);
        }}
        onCancel={() => setModelToDelete(null)}
      />
    </div>
  );
}
