import { ArrowLeft, Edit3, Trash2, Download, Bot, Rocket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import type { ModelAPI } from '../../types/modelApi';
import { Button } from '../../components/ui/Button';
import { useModelAPIMutations } from '../../hooks/useModelAPIs';
import { Input } from '../../components/ui/Input';
import { AccessModePicker } from '../../components/ui/Picker';
import { PackagePreview } from '../../components/ui/PackagePreview';
import type { ModelAPIFormValues } from '../../types/modelApi';
import { PageTabs } from '../../components/layout/PageTabs';

import { useParams } from 'react-router-dom';
import { useModelAPIs } from '../../hooks/useModelAPIs';

export default function ModelDetailPage() {
  const { modelId } = useParams();
  const { data } = useModelAPIs();
  const model = useMemo(() => data?.models.find((item) => item.id === Number(modelId)) ?? null, [data?.models, modelId]);

  if (!model) {
    return <div className="p-8 text-center text-gray-500">Model not found or loading...</div>;
  }

  return <ModelDetailPageContent model={model} />;
}

export function ModelDetailPageContent({ model }: { model: ModelAPI }) {
  const [activeTab, setActiveTab] = useState<'1' | '2'>('1');
  const [editing, setEditing] = useState(false);
  const { deleteModelAPI, deleting } = useModelAPIMutations();
  const { updateModelAPI, updating } = useModelAPIMutations();

  const [form, setForm] = useState<ModelAPIFormValues>({
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

  const isDirty = 
    form.name !== model.name ||
    form.description !== model.description ||
    form.model_info !== model.model_info ||
    form.access_mode !== model.access_mode;

  const handleSave = async () => {
    if (!isDirty) return;
    await updateModelAPI({ modelId: model.id, payload: form });
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

  const setField = (field: keyof ModelAPIFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const readOnlyFieldClass = 'cursor-default hover:border-gray-300 focus:border-gray-300';

  return (
    <section className="flex flex-col h-full gap-6">
      <div className="flex flex-col gap-4 border-b border-gray-300 md:flex-row md:items-end md:justify-between">
        <div className="mb-2">
          <Link to="/dashboard/api-management" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
            Back to API Management
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Model Details</h1>
        </div>
        
        <PageTabs
          tabs={[
            {
              label: 'Information',
              icon: Bot,
              isActive: activeTab === '1',
              onClick: () => setActiveTab('1'),
            },
            {
              label: 'Deployment',
              icon: Rocket,
              isActive: activeTab === '2',
              onClick: () => setActiveTab('2'),
            },
          ]}
        />
      </div>

      <div className="rounded-lg border border-gray-300 bg-white p-6 lg:p-8 flex flex-col flex-1">
        <div className="flex flex-col flex-1">
          {activeTab === '1' && (
            <div className="flex flex-col h-full space-y-6">
              <div className="flex justify-end mb-2">
                {editing ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="md" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                    <Button
                      size="md"
                      loading={updating}
                      disabled={!isDirty}
                      onClick={handleSave}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setForm({
                        name: model.name || '',
                        description: model.description || '',
                        model_info: model.model_info || '',
                        access_mode: model.access_mode || 'public',
                      });
                      setEditing(true);
                    }}
                  >
                    <Edit3 className="h-4 w-4" /> Edit
                  </Button>
                )}
              </div>
              
              <div className="flex flex-col flex-1 gap-5">
                <Input
                  id="model-name"
                  label="Model Name"
                  value={editing ? form.name : (model.name || '')}
                  onChange={(e) => setField('name', e.target.value)}
                  readOnly={!editing}
                  tabIndex={!editing ? -1 : undefined}
                  className={!editing ? readOnlyFieldClass : ''}
                />
                
                <label htmlFor="model-desc" className="flex flex-col gap-2 text-sm font-medium text-gray-700 shrink-0">
                  Description
                  <textarea
                    id="model-desc"
                    className={`text-sm text-gray-800 placeholder-gray-400 font-normal placeholder:font-normal h-25 w-full resize-y rounded-2xl border border-gray-300 bg-white py-3 px-4 outline-none transition-colors duration-200 disabled:bg-gray-50 disabled:text-gray-400 ${
                      editing ? 'hover:border-black focus:border-black' : 'cursor-default hover:border-gray-300 focus:border-gray-300'
                    }`}
                    value={editing ? form.description : (model.description || '')}
                    onChange={(e) => setField('description', e.target.value)}
                    readOnly={!editing}
                    tabIndex={!editing ? -1 : undefined}
                  />
                </label>

                <label htmlFor="model-info" className="flex flex-col flex-1 gap-2 text-sm font-medium text-gray-700">
                  Model Information
                  <textarea
                    id="model-info"
                    className={`text-sm text-gray-800 placeholder-gray-400 font-normal placeholder:font-normal flex-1 w-full resize-y rounded-2xl border border-gray-300 bg-white py-3 px-4 outline-none transition-colors duration-200 disabled:bg-gray-50 disabled:text-gray-400 ${
                      editing ? 'hover:border-black focus:border-black' : 'cursor-default hover:border-gray-300 focus:border-gray-300'
                    }`}
                    value={editing ? form.model_info : (model.model_info || '')}
                    onChange={(e) => setField('model_info', e.target.value)}
                    readOnly={!editing}
                    tabIndex={!editing ? -1 : undefined}
                  />
                </label>

                <div className="shrink-0">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Access Mode</label>
                  <AccessModePicker
                    value={editing ? form.access_mode : (model.access_mode || 'public')}
                    onChange={(v) => editing && setField('access_mode', v)}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === '2' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm font-semibold text-gray-500">Flavor</p>
                  <p className="mt-1 text-base text-gray-900 capitalize">{model.flavor || '-'}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-500">Package File</p>
                  <p className="mt-1 text-base text-gray-900 break-all">{zipFile}</p>
                </div>
                {model.package_preview_tree?.length ? (
                  <div className="md:col-span-2">
                    <p className="text-sm font-semibold text-gray-500 mb-2">Package Preview</p>
                    <PackagePreview preview={model.package_preview_tree} compact />
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <p className="text-sm font-semibold text-gray-500">Requirements.txt</p>
                  <pre className="mt-2 bg-gray-50 p-4 rounded-lg text-sm text-gray-700 whitespace-pre-wrap font-mono border border-gray-200 overflow-x-auto max-h-60">
                    {model.requirements_text || '-'}
                  </pre>
                </div>
                <div className="md:col-span-2">
                  <p className="text-sm font-semibold text-gray-500">Model API Endpoint</p>
                  <code className="mt-2 block bg-gray-50 p-4 rounded-lg text-sm text-gray-700 font-mono break-all border border-gray-200">
                    {model.endpoint_url || '-'}
                  </code>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-12 flex flex-col sm:flex-row items-center gap-4 border-t border-gray-200 pt-6 shrink-0">
          <Button
            className="w-full justify-center"
            variant="danger"
            size="md"
            icon={<Trash2 className="h-4 w-4" />}
            loading={deleting}
            onClick={() => deleteModelAPI(model.id)}
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
  );
}
