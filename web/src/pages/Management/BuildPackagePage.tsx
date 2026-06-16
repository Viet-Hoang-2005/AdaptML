import { FileArchive, FileCode2, FlaskConical, ListTree, Rocket, UploadCloud } from 'lucide-react';
import React from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import type { ModelBuildFormValues, ModelFlavor } from '../../types/modelApi';
import { AccessModePicker, FileDropzone, PackagePreview, StepTitle, SummaryItem, TextArea, } from './UploadModelFormPage';

const wizardSteps = [
  { id: 1, label: 'Metadata', icon: FileCode2 },
  { id: 2, label: 'Artifact', icon: UploadCloud },
  { id: 3, label: 'Flavor', icon: FlaskConical },
  { id: 4, label: 'Requirements', icon: FileArchive },
  { id: 5, label: 'Preview', icon: ListTree },
  { id: 6, label: 'Deploy', icon: Rocket },
];

export default function BuildPackagePage({
  step,
  setStep,
  form,
  setField,
  readRequirementsFile,
  preview,
  submit,
  loading,
  canContinue,
}: {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
  readRequirementsFile: (file: File | null) => void;
  preview: string[];
  submit: () => void;
  loading: boolean;
  canContinue: () => boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="hidden sm:block rounded-lg border border-gray-300 bg-white px-8 pb-10 pt-6">
        <div className="relative flex items-center justify-between">
          {/* Background line */}
          <div className="absolute left-0 top-5 h-0.5 w-full bg-gray-200" />
          {/* Active line */}
          <div
            className="absolute left-0 top-5 h-0.5 bg-black transition-all duration-300"
            style={{ width: `${((step - 1) / (wizardSteps.length - 1)) * 100}%` }}
          />

          {wizardSteps.map((item) => {
            const Icon = item.icon;
            const active = step === item.id;
            const done = step > item.id;
            const disabled = item.id > step;

            return (
              <div key={item.id} className="relative z-10 flex flex-col items-center bg-white px-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setStep(item.id)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    active
                      ? 'border-black bg-black text-white'
                      : done
                        ? 'border-black bg-white text-black hover:bg-gray-100'
                        : 'border-gray-200 bg-white text-gray-300'
                  } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
                <span
                  className={`absolute -bottom-7 whitespace-nowrap text-xs font-bold ${
                    active ? 'text-black' : done ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fallback stepper cho mobile */}
      <div className="sm:hidden rounded-lg border border-gray-300 bg-white p-4 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">Step {step} of {wizardSteps.length}</span>
        <span className="text-sm font-semibold text-gray-500">{wizardSteps[step - 1]?.label}</span>
      </div>

      <div className="rounded-lg border border-gray-300 bg-white p-6">
        {step === 1 && (
          <MetadataStep form={form} setField={setField} />
        )}
        {step === 2 && (
          <ArtifactStep form={form} setField={setField} />
        )}
        {step === 3 && (
          <FlavorStep form={form} setField={setField} />
        )}
        {step === 4 && (
          <RequirementsStep form={form} setField={setField} readRequirementsFile={readRequirementsFile} />
        )}
        {step === 5 && (
          <PreviewStep preview={preview} form={form} />
        )}
        {step === 6 && (
          <DeployStep form={form} preview={preview} submit={submit} loading={loading} />
        )}

        <div className="mt-8 flex justify-between border-t border-gray-200 pt-5">
          <Button
            variant="secondary"
            size="md"
            disabled={step === 1 || loading}
            onClick={() => setStep((current) => Math.max(1, current - 1))}
          >
            Back
          </Button>
          {step < 6 ? (
            <Button
              size="md"
              disabled={!canContinue() || loading}
              onClick={() => setStep((current) => Math.min(6, current + 1))}
            >
              Continue
            </Button>
          ) : (
            <Button
              size="md"
              icon={<Rocket className="h-4 w-4" />}
              disabled={!form.source_artifact || !form.name.trim()}
              loading={loading}
              onClick={submit}
            >
              Deploy model
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetadataStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Model metadata" description="Describe the model and decide whether the prediction API is public or private." />
      <Input
        label="Model Name"
        value={form.name}
        onChange={(event) => setField('name', event.target.value)}
        placeholder="e.g. CICIDS Classifier"
      />
      <TextArea
        id="build-description"
        label="Description"
        value={form.description}
        onChange={(value) => setField('description', value)}
        placeholder="What does this model classify or detect?"
      />
      <TextArea
        id="build-model-info"
        label="Model Information"
        value={form.model_info}
        onChange={(value) => setField('model_info', value)}
        placeholder="Framework, labels, expected inputs, F1 score, or other notes."
      />
      <AccessModePicker value={form.access_mode} onChange={(value) => setField('access_mode', value)} />
    </div>
  );
}

function ArtifactStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Upload raw artifact" description="Choose a model file. Phase 1 supports .pkl, .joblib, and .xgb artifacts." />
      <FileDropzone
        accept=".pkl,.joblib,.xgb"
        title={form.source_artifact ? form.source_artifact.name : 'Choose raw model artifact'}
        subtitle=".pkl, .joblib, or .xgb"
        onChange={(file) => setField('source_artifact', file)}
      />
    </div>
  );
}

function FlavorStep({
  form,
  setField,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
}) {
  const options: Array<{ value: ModelFlavor; title: string; description: string }> = [
    { value: 'sklearn', title: 'Scikit-learn', description: 'Use for sklearn estimators saved as .pkl or .joblib.' },
    { value: 'xgboost', title: 'XGBoost', description: 'Use for XGBoost Booster/XGBModel saved as .xgb, .pkl, or .joblib.' },
  ];

  return (
    <div className="space-y-5">
      <StepTitle title="Choose framework flavor" description="The packager uses this flavor to call the correct MLflow save_model function." />
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setField('flavor', option.value)}
            className={`rounded-2xl border p-5 text-left transition-colors ${
              form.flavor === option.value
                ? 'border-black bg-black text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-black'
            }`}
          >
            <span className="text-sm font-bold">{option.title}</span>
            <p className={`mt-2 text-sm leading-6 ${form.flavor === option.value ? 'text-gray-300' : 'text-gray-500'}`}>
              {option.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function RequirementsStep({
  form,
  setField,
  readRequirementsFile,
}: {
  form: ModelBuildFormValues;
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
  readRequirementsFile: (file: File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Runtime requirements" description="Paste requirements or upload requirements.txt. These lines are written into the MLflow package." />
      <FileDropzone
        accept=".txt,text/plain"
        title={form.requirements_file ? form.requirements_file.name : 'Upload requirements.txt'}
        subtitle="Optional"
        onChange={readRequirementsFile}
      />
      <TextArea
        id="requirements-text"
        label="requirements.txt"
        value={form.requirements_text}
        onChange={(value) => setField('requirements_text', value)}
        placeholder={'scikit-learn==1.7.2\npandas==2.2.1\nnumpy==1.26.4'}
        minHeight="min-h-48"
      />
    </div>
  );
}

function PreviewStep({ preview, form }: { preview: string[]; form: ModelBuildFormValues }) {
  return (
    <div className="space-y-5">
      <StepTitle title="Preview package structure" description="This is the expected MLflow package layout. Django stores the actual generated preview after deploy." />
      <PackagePreview preview={preview} />
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        Flavor: <span className="font-semibold text-gray-900">{form.flavor}</span>
      </div>
    </div>
  );
}

function DeployStep({
  form,
  preview,
  submit,
  loading,
}: {
  form: ModelBuildFormValues;
  preview: string[];
  submit: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-5">
      <StepTitle title="Deploy model API" description="The Control Plane will build the MLflow package, upload it to S3, then expose a model endpoint." />
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryItem label="Model" value={form.name || 'Untitled model'} />
        <SummaryItem label="Access" value={`${form.access_mode} API`} />
        <SummaryItem label="Flavor" value={form.flavor} />
        <SummaryItem label="Artifact" value={form.source_artifact?.name || 'Missing artifact'} />
      </div>
      <PackagePreview preview={preview} />
      <Button
        size="md"
        icon={<Rocket className="h-4 w-4" />}
        loading={loading}
        disabled={!form.name.trim() || !form.source_artifact}
        onClick={submit}
      >
        Build model
      </Button>
    </div>
  );
}
