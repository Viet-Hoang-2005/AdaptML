import { Copy } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { ApiModal } from '../../../components/ui/ApiModal';
import { useApiKeyForm } from '../../../hooks/useApiKeyForm';
import { useDeveloperSettings } from '../../../hooks/useDeveloperSettings';
import { useModelAPIs } from '../../../hooks/useModelAPIs';
import { toast } from '../../../lib/toast';
import { Table } from 'antd';
import type { TableProps } from 'antd';
import type { ModelAPI } from '../../../types/modelApi';
import { TitlePage } from '../../../components/ui/TitlePage';

export default function ApiKeyPage() {
  const { keyId } = useParams<{ keyId?: string }>();
  const navigate = useNavigate();
  const { apiKeys } = useDeveloperSettings();
  
  const editingKey = useMemo(() => {
    if (!keyId) return null;
    return apiKeys.find((k) => k.id === parseInt(keyId, 10)) || null;
  }, [keyId, apiKeys]);

  const {
    apiKeyName,
    setApiKeyName,
    apiKeyDescription,
    setApiKeyDescription,
    setApiKeyScope,
    apiKeyModels,
    setApiKeyModels,
    createdApiKey,
    setCreatedApiKey,
    handleSaveAPIKey,
    saving,
  } = useApiKeyForm(editingKey);

  const { data: modelsData } = useModelAPIs();

  const handleCopyCreatedKey = async () => {
    if (!createdApiKey?.api_key) return;
    try {
      await navigator.clipboard.writeText(createdApiKey.api_key);
      toast.success('API key copied to clipboard.');
    } catch {
      toast.warning('Unable to copy API key automatically.');
    }
  };

  const handleDone = () => {
    setCreatedApiKey(null);
    navigate('/dashboard/settings/developer');
  };

  const privateModels = useMemo(() => {
    const models = modelsData?.models || [];
    return models.filter(m => m.access_mode === 'private');
  }, [modelsData?.models]);

  const columns: TableProps<ModelAPI>['columns'] = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: '40%',
      render: (text: string) => <span className="font-medium text-gray-800">{text}</span>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (text: string) => <span className="text-gray-500">{text || '-'}</span>,
    },
  ];

  const rowSelection: TableProps<ModelAPI>['rowSelection'] = {
    selectedRowKeys: apiKeyModels,
    columnWidth: 100,
    onChange: (selectedRowKeys) => {
      setApiKeyModels(selectedRowKeys as number[]);
      setApiKeyScope('specific');
    },
  };

  return (
    <div className="flex w-full flex-col space-y-6">
      <TitlePage
        title={keyId ? 'Edit API Key' : 'Create API Key'}
        backLink={{ to: '/dashboard/settings/developer', label: 'Back to Developer Settings' }}
      />

      <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 space-y-6 shadow-sm">
        <div className="space-y-4">
          <Input
            id="input-api-key-name"
            label="API Name"
            placeholder="e.g. Production Inference Client"
            value={apiKeyName}
            onChange={(event) => setApiKeyName(event.target.value)}
          />
          <label htmlFor="input-api-key-description" className="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Description
            <textarea
              id="input-api-key-description"
              className="min-h-24 w-full resize-none rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors duration-200 placeholder:text-gray-400 hover:border-black focus:border-black"
              placeholder="What will this API key be used for?"
              value={apiKeyDescription}
              onChange={(event) => setApiKeyDescription(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-2 pt-2">
            <span className="text-sm font-medium text-gray-700">API Key Scope</span>
            <div className="rounded-xl border border-gray-300 bg-white overflow-hidden mt-1">
              <Table 
                columns={columns} 
                dataSource={privateModels} 
                rowKey="id" 
                rowSelection={rowSelection}
                pagination={{ pageSize: 5 }} 
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <span className="text-sm font-medium text-gray-700">How to use (Python)</span>
            <div className="relative rounded-xl border border-gray-200 bg-gray-950 overflow-hidden">
              <pre className="p-4 text-xs font-mono text-[#d4d4d4] overflow-x-auto custom-scrollbar">
                <span className="text-[#c586c0]">import</span> <span className="text-[#4ec9b0]">requests</span>{'\n\n'}
                <span className="text-[#4fc1ff]">API_URL</span> = <span className="text-[#ce9178]">"your_api_endpoint_url"</span>{'\n'}
                <span className="text-[#4fc1ff]">API_KEY</span> = <span className="text-[#ce9178]">"your_api_key_here"</span>{'\n\n'}
                <span className="text-[#9cdcfe]">headers</span> = {'{\n'}
                {'    '}<span className="text-[#ce9178]">"X-API-Key"</span>: <span className="text-[#4fc1ff]">API_KEY</span>,{'\n'}
                {'    '}<span className="text-[#ce9178]">"Content-Type"</span>: <span className="text-[#ce9178]">"application/json"</span>{'\n'}
                {'}\n\n'}
                <span className="text-[#9cdcfe]">payload</span> = {'{\n'}
                {'    '}<span className="text-[#ce9178]">"features"</span>: {'{\n'}
                {'        '}<span className="text-[#ce9178]">"Src Port"</span>: <span className="text-[#b5cea8]">443</span>,{'\n'}
                {'        '}<span className="text-[#6a9955]"># Add other features...</span>{'\n'}
                {'    }\n'}
                {'}\n\n'}
                <span className="text-[#9cdcfe]">response</span> = <span className="text-[#9cdcfe]">requests</span>.<span className="text-[#dcdcaa]">post</span>(<span className="text-[#4fc1ff]">API_URL</span>, <span className="text-[#9cdcfe]">json</span>=<span className="text-[#9cdcfe]">payload</span>, <span className="text-[#9cdcfe]">headers</span>=<span className="text-[#9cdcfe]">headers</span>){'\n'}
                <span className="text-[#dcdcaa]">print</span>(<span className="text-[#9cdcfe]">response</span>.<span className="text-[#dcdcaa]">json</span>())
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`import requests\n\nAPI_URL = "http://localhost:5000/predict"\nAPI_KEY = "your_api_key_here"\n\nheaders = {\n    "X-API-Key": API_KEY,\n    "Content-Type": "application/json"\n}\n\npayload = {\n    "features": {\n        "Src Port": 443,\n        # Add other features...\n    }\n}\n\nresponse = requests.post(API_URL, json=payload, headers=headers)\nprint(response.json())`);
                  toast.success('Code copied to clipboard.');
                }}
                className="absolute right-3 top-3 rounded-md bg-gray-800 p-2 text-gray-400 shadow-sm ring-1 ring-gray-700 hover:text-white hover:bg-gray-700 transition-colors"
                title="Copy code"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>

        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-6">
          <Button variant="secondary" onClick={() => navigate('/dashboard/settings/developer')}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSaveAPIKey}>
            {keyId ? 'Save changes' : 'Create API Key'}
          </Button>
        </div>
      </div>

      {createdApiKey && (
        <ApiModal
          title="API Key Created"
          description="This key is shown once. Store it now before closing this modal."
          apiKey={createdApiKey.api_key}
          onClose={handleDone}
          onCopy={handleCopyCreatedKey}
        />
      )}
    </div>
  );
}
