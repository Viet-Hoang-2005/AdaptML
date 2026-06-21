import { useState } from 'react';
import { Bot, Edit3, Trash2, Search, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Table, Space, Button as AntButton, Popconfirm } from 'antd';
import type { TableProps } from 'antd';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import Placeholder from '../../components/layout/Placeholder';
import { useModelAPIs, useModelAPIMutations } from '../../hooks/useModelAPIs';
import type { ModelAPI } from '../../types/modelApi';
import EditModelModal from './EditModelModal';

export default function APIManagementPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useModelAPIs();
  const { deleteModelAPI } = useModelAPIMutations();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelAPI | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  
  const models = data?.models ?? [];
  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const columns: TableProps<ModelAPI>['columns'] = [
    {
      title: '#',
      dataIndex: 'index',
      align: 'center',
      key: 'index',
      render: (_text: unknown, _record: ModelAPI, index: number) => index + 1,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ModelAPI) => (
        <a 
          className="font-medium text-black! hover:opacity-60!" 
          onClick={(e) => {
            e.preventDefault();
            navigate(`/dashboard/api-management/${record.id}`);
          }}
        >
          {text}
        </a>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (text: string) => (
        <span className="line-clamp-2 max-w-sm text-sm text-gray-500">
          {text || 'No description provided.'}
        </span>
      ),
    },
    {
      title: 'Flavor',
      dataIndex: 'flavor',
      key: 'flavor',
      render: (text: string) => (
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold capitalize text-gray-700">
          {text ? text : '-'}
        </span>
      ),
    },
    {
      title: 'Access',
      dataIndex: 'access_mode',
      key: 'access',
      render: (text: string) => (
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold capitalize text-gray-700">
          {text}
        </span>
      ),
    },
    {
      title: 'Update',
      dataIndex: 'updated_at',
      key: 'updated',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: 'Action',
      align: 'center',
      key: 'action',
      render: (_: unknown, record: ModelAPI) => (
        <Space size="middle">
          <AntButton 
            type="text" 
            icon={<Edit3 className="h-4 w-4" />} 
            onClick={() => {
              setSelectedModel(record);
              setIsModalVisible(true);
            }} 
          />
          <Popconfirm
            title="Delete the model API"
            description="Are you sure to delete this model API?"
            onConfirm={() => deleteModelAPI(record.id)}
            okText="Yes"
            cancelText="No"
            okButtonProps={{ className: 'bg-red-500! hover:bg-red-600! border-none! text-white!' }}
            cancelButtonProps={{ className: 'bg-white! hover:bg-gray-100! border! border-gray-300! text-black!' }}
          >
            <AntButton 
              type="text"
              className="text-red-500! hover:text-red-600!"
              icon={<Trash2 className="h-4 w-4" />} 
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <div className="border-b border-gray-300 pb-2">
        <h1 className="text-lg font-bold text-gray-900">API Management</h1>
      </div>

      <section className="flex flex-1 flex-col rounded-lg border border-gray-300 bg-white">
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
              className="px-4"
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
              <Table
                columns={columns} 
                dataSource={filteredModels} 
                rowKey="id" 
                pagination={{ pageSize: 10 }} 
              />
            )}
          </div>
        </div>
      </section>
      
      <EditModelModal
        key={`edit-modal-${selectedModel?.id || 'none'}-${isModalVisible}`}
        model={selectedModel}
        visible={isModalVisible}
        onClose={() => {
          setIsModalVisible(false);
          setSelectedModel(null);
        }}
      />
    </div>
  );
}
