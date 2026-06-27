import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { PageContent } from '../../components/layout/PageContent';
import { Button } from '../../components/ui/Button';
import axiosInstance from '../../lib/axios';
import { controlPlaneURL } from '../../lib/api';
import { toast } from '../../lib/toast';

export default function DriftReportPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const reportS3Uri = location.state?.reportS3Uri;

  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reportS3Uri) {
      toast.error("No report URI provided");
      navigate(`/dashboard/drift-monitoring/${modelId}`);
      return;
    }

    axiosInstance.post(controlPlaneURL('/drift/presigned-url/'), { s3_uri: reportS3Uri })
      .then(res => {
        setReportUrl(res.data.url);
        setLoading(false);
      })
      .catch(err => {
        toast.error(err.message || "Failed to generate report URL");
        setLoading(false);
      });
  }, [reportS3Uri, modelId, navigate]);

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
      
      <PageContent className="flex-1 overflow-hidden bg-gray-50 flex items-center justify-center relative p-0 border-t border-gray-200 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center text-gray-500">
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
      </PageContent>
    </div>
  );
}
