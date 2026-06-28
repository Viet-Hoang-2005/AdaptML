import { Bot, FileArchive } from 'lucide-react';
import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, useBlocker } from 'react-router-dom';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { deleteModelAPI as deleteModelAPICore } from '../../../lib/api';
import type { ModelAPIFormValues, ModelBuildFormValues } from '../../../types/modelApi';
import BuildPackagePage from './BuildPackagePage';
import MLflowZipPage from './MLflowZipPage';
import { PageHeader } from '../../../components/layout/PageHeader';

const emptyAdvancedForm: ModelAPIFormValues = {
  name: '',
  description: '',
  model_info: '',
  access_mode: 'public',
  artifact: null,
};

const emptyBuildForm: ModelBuildFormValues = {
  name: '',
  version: 'v1',
  description: '',
  model_info: '',
  access_mode: 'public',
  source_artifact: null,
  flavor: 'sklearn',
  requirements_text: '',
  requirements_file: null,
  label_mapping_file: null,
  metrics_file: null,
  params_file: null,
  model_insights_file: null,
  feature_importance_file: null,
  input_schema_file: null,
};

export default function UploadModelPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.pathname.includes('mlflow-zip') ? 'advanced' : 'builder';
  
  const [createdModelId, setCreatedModelId] = useState<string | null>(null);
  const [advancedForm, setAdvancedForm] = useState<ModelAPIFormValues>(emptyAdvancedForm);
  const [buildForm, setBuildForm] = useState<ModelBuildFormValues>(emptyBuildForm);

  const setAdvancedField = (field: keyof ModelAPIFormValues, value: string | File | null) => {
    setAdvancedForm((current) => ({ ...current, [field]: value }));
  };

  const setBuildField = (field: keyof ModelBuildFormValues, value: string | File | null) => {
    setBuildForm((current) => ({ ...current, [field]: value }));
  };

  const isSubmittingRef = useRef(false);

  const isDirty = useMemo(() => {
    if (mode === 'advanced') {
       return Boolean(advancedForm.name || advancedForm.artifact);
    } else {
       return Boolean(buildForm.name || buildForm.source_artifact || createdModelId);
    }
  }, [mode, advancedForm, buildForm, createdModelId]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (isSubmittingRef.current) return false;
    return isDirty && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty || isSubmittingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const readRequirementsFile = async (file: File | null) => {
    setBuildField('requirements_file', file);
    if (!file) return;
    const text = await file.text();
    setBuildField('requirements_text', text);
  };

  return (
    <section className="space-y-6">
      <ConfirmModal
        open={blocker.state === 'blocked'}
        title="Discard Unsaved Changes?"
        description="If you leave this page, your unsaved progress, uploaded artifacts, and running builds will be completely deleted. Are you sure you want to leave?"
        tone="danger"
        confirmText="Leave and Discard"
        onConfirm={async () => {
          if (createdModelId) {
            await deleteModelAPICore(createdModelId, true).catch(() => {});
          }
          setAdvancedForm(emptyAdvancedForm);
          setBuildForm(emptyBuildForm);
          setCreatedModelId(null);
          blocker.proceed?.();
        }}
        onCancel={() => {
          blocker.reset?.();
        }}
      />
      <PageHeader
        title="Upload model"
        backLink={{ to: '/dashboard/api-management', label: 'Back to API Management' }}
        tabs={[
          {
            label: 'Auto build package',
            icon: Bot,
            isActive: mode === 'builder',
            onClick: () => navigate('/dashboard/api-management/upload/build-package'),
          },
          {
            label: 'Advanced MLflow ZIP',
            icon: FileArchive,
            isActive: mode === 'advanced',
            onClick: () => navigate('/dashboard/api-management/upload/mlflow-zip'),
          },
        ]}
      />

      {mode === 'advanced' ? (
        <MLflowZipPage
          form={advancedForm}
          setField={setAdvancedField}
          onSubmitting={(val) => {
            isSubmittingRef.current = val;
          }}
          onModelCreated={(id) => setCreatedModelId(id)}
        />
      ) : (
        <BuildPackagePage
          form={buildForm}
          setField={setBuildField}
          readRequirementsFile={readRequirementsFile}
          onSubmitting={(val) => {
            isSubmittingRef.current = val;
          }}
          onModelCreated={(id) => setCreatedModelId(id)}
        />
      )}
    </section>
  );
}


export function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-semibold uppercase text-gray-400">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
