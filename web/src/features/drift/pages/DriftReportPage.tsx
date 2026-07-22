import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageBody } from '@/shared/ui/PageBody';
import { Button } from '@/shared/ui/Button';
import { getDriftReportDownloadUrl } from '@/features/drift/api/driftApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';

export default function DriftReportPage() {
  const { modelId, runId } = useParams<{ modelId: string; runId: string }>();
  const navigate = useNavigate();

  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) {
      toast.error("No drift run provided");
      navigate(`/dashboard/drift-monitoring/${modelId}`);
      return;
    }

    getDriftReportDownloadUrl(runId)
      .then(url => {
        setReportUrl(url);
        setLoading(false);
      })
      .catch(err => {
        toast.error(getApiErrorMessage(err, "Failed to generate report URL"));
        setLoading(false);
      });
  }, [runId, modelId, navigate]);

  const handleDownload = async () => {
    if (!reportUrl) return;
    try {
      const response = await fetch(reportUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drift-report-${modelId}.html`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download report";
      toast.error(message);
      window.open(reportUrl, '_blank');
    }
  };

  return (
    <div className="flex w-full flex-1 flex-col min-h-0 space-y-6">
      <PageHeader 
        title="Evidently AI Report"
        backLink={{ to: `/dashboard/drift-monitoring/${modelId}`, label: "Back to Monitoring" }}
      >
        {reportUrl && (
          <Button size="md" icon={<Download className='w-4 h-4'/>} onClick={handleDownload}>
            Download
          </Button>
        )}
      </PageHeader>
      
      <PageBody className="flex-1 overflow-hidden bg-muted flex items-center justify-center relative p-0 border-t border-border min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p>Loading report...</p>
          </div>
        ) : reportUrl ? (
          <iframe 
            src={reportUrl} 
            title="Evidently Report"
            className="absolute inset-0 w-full h-full border-0"
          />
        ) : (
          <div className="text-red-500 py-20">Failed to load report.</div>
        )}
      </PageBody>
    </div>
  );
}
