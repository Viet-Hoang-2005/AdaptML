import { Edit3, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Table, Space, Button as AntButton, Popconfirm, Tag } from 'antd';
import type { TableProps } from 'antd';
import { Button } from '../../../components/ui/Button';
import { ApiModal } from '../../../components/ui/ApiModal';
import { useDeveloperSettings } from '../../../hooks/useDeveloperSettings';
import { useModelAPIs } from '../../../hooks/useModelAPIs';
import type { APIKeyRecord } from '../../../types/auth';
import { PageContent } from '../../../components/layout/PageContent';

export default function DeveloperSettingPage() {
  const navigate = useNavigate();
  const { data: modelsData } = useModelAPIs();
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

  const columns: TableProps<APIKeyRecord>['columns'] = [
    {
      title: '#',
      dataIndex: 'index',
      align: 'center',
      width: 60,
      render: (_text, _record, index) => index + 1,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <span className="font-bold text-gray-900">{text}</span>
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
      title: 'Specific Models',
      dataIndex: 'scope',
      key: 'models',
      render: (scope: string, record: APIKeyRecord) => {
        if (scope === 'all') {
          return <Tag color="blue">All Models</Tag>;
        }
        if (!record.allowed_models || record.allowed_models.length === 0) {
          return <Tag color="red">None</Tag>;
        }
        return (
          <div className="flex flex-wrap gap-1 max-w-xs">
            {record.allowed_models.map(id => (
              <Tag key={id}>{modelIdToName[id] || `Unknown (${id})`}</Tag>
            ))}
          </div>
        );
      },
    },
    {
      title: 'Updated',
      dataIndex: 'created_at',
      key: 'updated',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: 'Action',
      align: 'center',
      key: 'action',
      render: (_: unknown, record: APIKeyRecord) => (
        <Space size="middle">
          <AntButton 
            type="text" 
            icon={<Edit3 className="h-4 w-4" />} 
            onClick={() => navigate(`/dashboard/settings/developer/api-keys/${record.id}`)}
          />
          <Popconfirm
            title="Regenerate API key"
            description="Are you sure you want to regenerate this API key?"
            onConfirm={() => handleRegenerateAPIKey(record)}
            okText="Yes"
            cancelText="No"
            okButtonProps={{ className: 'bg-blue-500! hover:bg-blue-600! border-none! text-white!' }}
            cancelButtonProps={{ className: 'bg-white! hover:bg-gray-100! border! border-gray-300! text-black!' }}
          >
            <AntButton 
              type="text"
              icon={<RefreshCw className="h-4 w-4" />} 
            />
          </Popconfirm>
          <Popconfirm
            title="Delete API key"
            description="Are you sure you want to delete this API key?"
            onConfirm={() => handleDeleteAPIKey(record)}
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
          <Table 
            columns={columns} 
            dataSource={apiKeys} 
            rowKey="id" 
            loading={loading}
            pagination={{ pageSize: 10 }} 
          />
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
    </div>
  );
}
