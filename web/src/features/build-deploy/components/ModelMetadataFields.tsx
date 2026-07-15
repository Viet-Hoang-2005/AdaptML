import { AccessModePicker } from '@/features/catalog/components/AccessModePicker';
import type {
  ModelArtifactFormat,
  ModelBuildFormValues,
  ModelBuildInputAsset,
  ModelFlavor,
} from '@/features/catalog/types';
import { FileDropzone } from '@/shared/ui/FileDropzone';
import { Input } from '@/shared/ui/Input';
import { Picker } from '@/shared/ui/Picker';
import { StepTitle } from '@/shared/ui/StepTitle';
import { TextArea } from '@/shared/ui/TextArea';
import { Switch } from '@/shared/ui/Switch';

interface ModelMetadataFieldsProps {
  form: ModelBuildFormValues;
  assets?: ModelBuildInputAsset[];
  setField: (field: keyof ModelBuildFormValues, value: string | File | null) => void;
  onRequirementsFile: (file: File | null) => void;
}

const assetName = (assets: ModelBuildInputAsset[] | undefined, kind: ModelBuildInputAsset['kind']) =>
  assets?.find((asset) => asset.kind === kind)?.name;

const rawExtensions: Record<ModelFlavor, string[]> = {
  sklearn: ['.pkl', '.joblib'],
  xgboost: ['.xgb', '.pkl', '.joblib'],
  pytorch: ['.pt', '.pth'],
  tensorflow: ['.h5', '.keras'],
};

const isPackageZip = (name: string | undefined) => name?.toLowerCase().endsWith('.zip') ?? false;

const packageExamples: Record<ModelFlavor, string[]> = {
  sklearn: [
    'model-package.zip',
    '├── MLmodel',
    '├── model.pkl',
    '├── requirements.txt',
    '└── python_env.yaml',
  ],
  xgboost: [
    'model-package.zip',
    '├── MLmodel',
    '├── model.xgb',
    '├── requirements.txt',
    '└── python_env.yaml',
  ],
  pytorch: [
    'model-package.zip',
    '├── MLmodel',
    '├── data/',
    '│   └── model.pth',
    '├── requirements.txt',
    '└── python_env.yaml',
  ],
  tensorflow: [
    'model-package.zip',
    '├── MLmodel',
    '├── data/',
    '│   └── model.keras',
    '├── requirements.txt',
    '└── python_env.yaml',
  ],
};

export function ModelMetadataFields({ form, assets, setField, onRequirementsFile }: ModelMetadataFieldsProps) {
  const flavorOptions: Array<{ value: ModelFlavor; title: string; description: string }> = [
    { value: 'sklearn', title: 'Scikit-learn', description: 'Pickle or joblib estimators.' },
    { value: 'xgboost', title: 'XGBoost', description: 'Booster or XGBModel artifacts.' },
    { value: 'pytorch', title: 'PyTorch', description: 'PyTorch or MLflow artifacts.' },
    { value: 'tensorflow', title: 'TensorFlow', description: 'Keras, SavedModel, or MLflow artifacts.' },
  ];
  const sourceArtifactName = assetName(assets, 'source_artifact');
  const selectedExtensions = form.artifact_format === 'mlflow_zip'
    ? ['.zip']
    : rawExtensions[form.flavor];
  const matchingSavedArtifact = sourceArtifactName
    && (form.artifact_format === 'mlflow_zip' ? isPackageZip(sourceArtifactName) : !isPackageZip(sourceArtifactName))
    ? sourceArtifactName
    : undefined;
  const selectArtifactFormat = (artifactFormat: ModelArtifactFormat) => {
    if (artifactFormat === form.artifact_format) return;
    setField('artifact_format', artifactFormat);
    setField('source_artifact', null);
    if (artifactFormat === 'mlflow_zip') {
      setField('label_mapping_file', null);
      setField('metrics_file', null);
      setField('params_file', null);
      setField('model_insights_file', null);
      setField('feature_importance_file', null);
      setField('input_schema_file', null);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="space-y-5">
        <StepTitle title="Model metadata" description="Describe the model and decide whether the prediction API is public or private." />
        <Input
          id="metadata-name"
          label="Model Name"
          value={form.name}
          onChange={(event) => setField('name', event.target.value)}
          placeholder="e.g. CICIDS Classifier"
        />
        <TextArea
          id="metadata-description"
          label="Description"
          value={form.description}
          onChange={(value) => setField('description', value)}
          placeholder="What does this model classify or detect?"
        />
        <AccessModePicker value={form.access_mode} onChange={(value) => setField('access_mode', value)} />
      </section>

      <hr className="border-border" />

      <section className="space-y-5">
        <StepTitle title="Framework flavor" description="Select the framework used to load the uploaded model." />
        <Picker value={form.flavor} onChange={(value) => setField('flavor', value)} options={flavorOptions} />
      </section>

      <hr className="border-border" />

      <section className="space-y-5">
        <StepTitle title="Model artifact" description="Choose a raw model file or a self-contained MLflow model package ZIP." />
        <Switch
          value={form.artifact_format}
          onChange={(val) => selectArtifactFormat(val as ModelArtifactFormat)}
          options={[
            { value: 'raw', title: 'Raw Model' },
            { value: 'mlflow_zip', title: 'Model Package' },
          ]}
          ariaLabel="Artifact upload format"
        />
        <FileDropzone
          accept={selectedExtensions.join(',')}
          title={form.source_artifact?.name || matchingSavedArtifact || (form.artifact_format === 'mlflow_zip' ? 'Choose model package ZIP' : 'Choose raw model artifact')}
          subtitle={form.artifact_format === 'mlflow_zip'
            ? 'Upload one .zip package containing the complete model artifact'
            : `Allowed ${form.flavor} files: ${selectedExtensions.join(', ')}`}
          onChange={(file) => setField('source_artifact', file)}
        />
        {form.artifact_format === 'mlflow_zip' ? (
          <div className="rounded-lg border border-border bg-muted p-4">
            <p className="text-sm font-semibold text-foreground">Expected {form.flavor} package layout</p>
            <p className="mt-1 text-xs text-muted-foreground">The ZIP may contain additional model files, but it must include an MLmodel file.</p>
            <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-xs leading-6 text-foreground">
              {packageExamples[form.flavor].join('\n')}
            </pre>
          </div>
        ) : (
          <>
            <FileDropzone
              accept=".pkl,.json"
              title={form.label_mapping_file?.name || assetName(assets, 'label_mapping') || 'Choose label mapping (optional)'}
              subtitle="Optional .pkl or .json label mapping"
              onChange={(file) => setField('label_mapping_file', file)}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <FileDropzone accept=".json" title={form.metrics_file?.name || assetName(assets, 'metrics') || 'Choose metrics.json'} subtitle="Optional metrics summary" onChange={(file) => setField('metrics_file', file)} />
              <FileDropzone accept=".json" title={form.params_file?.name || assetName(assets, 'params') || 'Choose params.json'} subtitle="Optional parameter summary" onChange={(file) => setField('params_file', file)} />
              <FileDropzone accept=".json" title={form.model_insights_file?.name || assetName(assets, 'model_insights') || 'Choose model insights'} subtitle="Optional insights or coefficients" onChange={(file) => setField('model_insights_file', file)} />
              <FileDropzone accept=".json" title={form.feature_importance_file?.name || assetName(assets, 'feature_importance') || 'Choose feature importance'} subtitle="Optional feature importance map" onChange={(file) => setField('feature_importance_file', file)} />
            </div>
          </>
        )}
      </section>

      <hr className="border-border" />

      <section className="space-y-5">
        <StepTitle title="Requirements" description="Paste requirements or import requirements.txt for the image build." />
        <FileDropzone accept=".txt,text/plain" title={form.requirements_file?.name || 'Upload requirements.txt'} subtitle="Optional" onChange={onRequirementsFile} />
        <TextArea
          id="metadata-requirements"
          value={form.requirements_text}
          onChange={(value) => setField('requirements_text', value)}
          placeholder={'scikit-learn==1.7.2\npandas==2.2.1\nnumpy==1.26.4'}
          minHeight="min-h-48"
        />
      </section>

      <hr className="border-border" />

      <section className="space-y-5">
        <StepTitle title="Source & References" description="Keep optional source code and reference data with this project for retraining and monitoring." />
        <FileDropzone accept=".zip,.py" title={form.source_code_file?.name || 'Choose source code'} subtitle="Optional .py or .zip" onChange={(file) => setField('source_code_file', file)} />
        <FileDropzone accept=".zip,.csv" title={form.reference_data_file?.name || 'Choose reference data'} subtitle="Optional .csv or .zip" onChange={(file) => setField('reference_data_file', file)} />
      </section>
    </div>
  );
}
