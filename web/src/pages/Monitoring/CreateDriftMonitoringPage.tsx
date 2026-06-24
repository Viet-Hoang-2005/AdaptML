import React, { useState } from 'react';
import Papa from 'papaparse';
import { useParams, useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';
import { Slider } from '../../components/ui/Slider';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { CSVEditor } from '../../components/ui/CSVEditor';
import { SourceEditor } from '../../components/ui/SourceEditor';
import { StepTitle } from '../../components/ui/StepTitle';
import { useCreateDriftMonitoringJob, useProductionData } from '../../hooks/useDriftMonitoring';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';

const THRESHOLD_MARKS = [
  { value: 500, label: '500' },
  { value: 1000, label: '1000' },
  { value: 2000, label: '2000' },
  { value: 5000, label: '5000' },
  { value: 10000, label: '10K' },
  { value: 20000, label: '20K' },
];

export default function CreateDriftMonitoringPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const navigate = useNavigate();

  const [referenceS3Uri, setReferenceS3Uri] = useState<string>('');
  const [triggerThreshold, setTriggerThreshold] = useState<number>(1000);
  
  const { data: productionLogs } = useProductionData(modelId);
  const { mutateAsync: createJob, isPending: isSubmitting } = useCreateDriftMonitoringJob();

  // Convert production logs (features + prediction) to CSV for preview
  // Each row: spread all feature key-value pairs + prediction column
  const productionCsv = React.useMemo(() => {
    if (!productionLogs || productionLogs.length === 0) return '';
    
    const rows = productionLogs.map(log => {
      let features: Record<string, unknown> = {};
      if (log.features) {
        if (typeof log.features === 'string') {
          try { 
            features = JSON.parse(log.features); 
          } catch { 
            features = {}; 
          }
        } else if (typeof log.features === 'object') {
          features = log.features as Record<string, unknown>;
        }
      }
      return { ...features, prediction: log.prediction };
    });
    
    return Papa.unparse(rows);
  }, [productionLogs]);

  const handleSubmit = async () => {
    if (!referenceS3Uri) {
      toast.error('Please select a reference data file to set as main.');
      return;
    }
    try {
      await createJob({
        model_id: modelId!,
        trigger_threshold: triggerThreshold,
        reference_data_s3_path: referenceS3Uri,
      });
      toast.success('Drift monitoring config created!');
      navigate(`/dashboard/drift-monitoring/${modelId}`);
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Failed to create config');
      toast.error(msg);
    }
  };

  return (
    <div className="flex w-full flex-1 flex-col space-y-6">
      <PageHeader 
        title="Create Drift Monitoring"
        backLink={{ label: "Back to Dashboard", to: `/dashboard/drift-monitoring/${modelId}` }}
      />
      <section className="flex flex-col flex-1 rounded-lg border border-gray-300 bg-white p-6 space-y-6">

      <div className="space-y-4">
        <StepTitle 
          title="Select Reference Data"
          description="Select or upload a baseline CSV file to act as the reference dataset for detecting drift."
        />
        <SourceEditor 
          modelId={modelId!} 
          fileType="data_file"
          title="Reference Data"
          icon={<Database className="w-4 h-4" />}
          accept=".csv"
          editorType="csv"
          currentEntryPoint={referenceS3Uri}
          onSetEntryPoint={setReferenceS3Uri}
          entryPointExtension=".csv"
          setAsMainLabel="Set as Reference"
        />
      </div>

      <div className="space-y-4 border-t border-gray-200 pt-6">
        <StepTitle 
          title="Set Trigger Threshold"
          description="Configure how many new production predictions must be logged before a drift check is triggered."
        />
        <div className="px-8 pb-4">
          <Slider 
            options={THRESHOLD_MARKS}
            value={triggerThreshold}
            onChange={(val) => setTriggerThreshold(val)}
            getColor={(index) => {
              if (index >= 5) return 'bg-red-500';
              if (index >= 3) return 'bg-yellow-500';
              return 'bg-green-500';
            }}
          />
        </div>
      </div>

      <div className="space-y-4 border-t border-gray-200 pt-6">
        <StepTitle 
          title="Production Data Preview"
          description="Preview the latest 50 records from your production database that will be used in future drift reports."
        />
        <div className="h-100 rounded-xl border border-gray-200 overflow-hidden relative bg-gray-50">
          {productionCsv ? (
            <CSVEditor initialCsvText={productionCsv} readOnly={true} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Database className="w-8 h-8 text-gray-400 mb-2" />
              <p>No production data available yet.</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-gray-200 pt-6">
        <Button 
          variant="secondary" 
          size="md"
          className="flex-1"
          onClick={() => navigate(`/dashboard/drift-monitoring/${modelId}`)}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button 
          variant="primary"
          size="md"
          className="flex-1"
          onClick={handleSubmit}
          disabled={isSubmitting || !referenceS3Uri}
        >
          {isSubmitting ? 'Saving...' : 'Create'}
        </Button>
      </div>
    </section>
  </div>
  );
}
