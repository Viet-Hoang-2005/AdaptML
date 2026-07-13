import { ArrowLeft, Trash2, Download, Bot, Rocket, Database, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import type { ModelProject } from '@/features/catalog/types';
import { Button } from '@/shared/ui/Button';
import { useModelProjectMutations } from '@/features/catalog/hooks/useModelProjects';
import type { ModelProjectFormValues } from '@/features/catalog/types';
import { PageTabs } from '@/shared/ui/PageTabs';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useModelProjects } from '@/features/catalog/hooks/useModelProjects';

// Import sub-pages
import { ModelInformationPage } from './ModelInformationPage';
import { ModelDeploymentPage } from './ModelDeploymentPage';
import { ModelSourcePage } from './ModelSourcePage';
import { ModelStatus } from '@/features/build-deploy/components/ModelStatus';

export default function ModelDetailPage() {
  const { modelId } = useParams();
  const { data } = useModelProjects();
  const model = useMemo(() => data?.models.find((item) => item.id === modelId) ?? null, [data?.models, modelId]);

  if (!model) {
    return <div className="p-8 text-center text-muted-foreground">Model not found or loading...</div>;
  }

  return <ModelDetailPageContent model={model} />;
}

export function ModelDetailPageContent({ model }: { model: ModelProject }) {
  const { tab } = useParams();
  const navigate = useNavigate();

  const activeTab = tab === 'source' ? '3' : tab === 'deployment' ? '2' : tab === 'status' ? '4' : '1';
  
  const handleTabChange = (newTab: 'information' | 'deployment' | 'source' | 'status') => {
    navigate(`/dashboard/api-management/${model.id}/${newTab}`);
  };

  const [editing, setEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { deleteModelProject, deleting } = useModelProjectMutations();
  const { updateModelProject, updating } = useModelProjectMutations();

  const [sourceCodeDirty, setSourceCodeDirty] = useState(false);
  const [referenceDataDirty, setReferenceDataDirty] = useState(false);
  const isAnyDirty = sourceCodeDirty || referenceDataDirty;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => isAnyDirty && currentLocation.pathname !== nextLocation.pathname
  );

  const [form, setForm] = useState<ModelProjectFormValues>({
    name: model.name || '',
    description: model.description || '',
    model_info: model.model_info || '',
    access_mode: model.access_mode || 'public',
  });

  const zipFile = useMemo(() => {
    if (!model.model_uri) return '-';
    try {
      const url = new URL(model.model_uri);
      return url.pathname.split('/').pop() || '-';
    } catch {
      return model.model_uri.split('/').pop() || '-';
    }
  }, [model.model_uri]);

  const isFormDirty = 
    form.name !== (model.name || '') ||
    form.description !== (model.description || '') ||
    form.model_info !== (model.model_info || '') ||
    form.access_mode !== (model.access_mode || 'public');

  const handleSave = async () => {
    if (!isFormDirty) return;
    await updateModelProject({ modelId: model.id, payload: form });
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setForm({
      name: model.name || '',
      description: model.description || '',
      model_info: model.model_info || '',
      access_mode: model.access_mode || 'public',
    });
    setEditing(false);
  };

  const setField = (field: keyof ModelProjectFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const readOnlyFieldClass = 'cursor-default hover:border-border focus:border-border';

  return (
    <>
      <ConfirmModal
        open={blocker.state === 'blocked'}
        title="Discard Unsaved Changes?"
        description="You have unsaved changes in your source code or reference data. If you leave this page, your changes will be lost. Are you sure you want to leave?"
        tone="danger"
        confirmText="Leave and Discard"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
      <section className="flex flex-col h-full gap-6">
        <div className="flex flex-col gap-4 border-b border-border md:flex-row md:items-end md:justify-between">
          <div className="mb-2">
            <Link to="/dashboard/api-management" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to API Management
            </Link>
            <h1 className="text-xl font-bold text-foreground">Model Details</h1>
          </div>
          
          <PageTabs
            tabs={[
              {
                label: 'Information',
                icon: Bot,
                isActive: activeTab === '1',
                onClick: () => handleTabChange('information'),
              },
              {
                label: 'Deployment',
                icon: Rocket,
                isActive: activeTab === '2',
                onClick: () => handleTabChange('deployment'),
              },
              {
                label: 'Source',
                icon: Database,
                isActive: activeTab === '3',
                onClick: () => handleTabChange('source'),
              },
              {
                label: 'Status',
                icon: Activity,
                isActive: activeTab === '4',
                onClick: () => handleTabChange('status'),
              },
            ]}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 lg:p-8 flex flex-col flex-1">
          <div className="flex flex-col flex-1">
            {activeTab === '1' && (
              <ModelInformationPage 
                model={model}
                editing={editing}
                form={form}
                isFormDirty={isFormDirty}
                updating={updating}
                readOnlyFieldClass={readOnlyFieldClass}
                handleCancelEdit={handleCancelEdit}
                handleSave={handleSave}
                setEditing={setEditing}
                setField={setField}
                setForm={setForm}
              />
            )}

            {activeTab === '2' && (
              <ModelDeploymentPage 
                model={model}
                zipFile={zipFile}
              />
            )}

            {activeTab === '3' && (
              <ModelSourcePage 
                model={model}
                setSourceCodeDirty={setSourceCodeDirty}
                setReferenceDataDirty={setReferenceDataDirty}
              />
            )}

            {activeTab === '4' && (
              <ModelStatus model={model} />
            )}
          </div>

          <div className="mt-12 flex flex-col sm:flex-row items-center gap-4 border-t border-border pt-6 shrink-0">
            <Button
              className="w-full justify-center"
              variant="danger"
              size="md"
              icon={<Trash2 className="h-4 w-4" />}
              loading={deleting}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete model
            </Button>
            <Button
              className="w-full justify-center"
              size="md"
              icon={<Download className="h-4 w-4" />}
              onClick={() => {
                if (model.model_uri) {
                  window.open(model.model_uri, '_blank');
                }
              }}
            >
              Download model
            </Button>
          </div>
        </div>
      </section>

      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete Model"
        description={<p>Are you sure you want to permanently delete the model <strong>{model.name}</strong>? This action will completely remove all source code, datasets, compiled artifacts from S3, and database records. This action cannot be undone.</p>}
        confirmText="Delete Model"
        cancelText="Cancel"
        tone="danger"
        loading={deleting}
        onConfirm={async () => {
          await deleteModelProject(model.id);
          setShowDeleteConfirm(false);
          // navigate is already handled in useModelProjects hooks onSuccess
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
