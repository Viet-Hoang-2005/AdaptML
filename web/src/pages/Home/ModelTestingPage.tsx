import { FileSpreadsheet, Play, Pause, Download, Trash2 } from 'lucide-react';
import { useState, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { predictWithModelAPI } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { useModelSelection } from '../../hooks/useModelSelection';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { TerminalLogViewer } from '../../components/ui/TerminalLogViewer';
import { CSVEditor } from '../../components/ui/CSVEditor';

const parseCSV = (text: string) => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0]?.split(',').map((header) => header.trim()) ?? [];
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return headers.reduce<Record<string, unknown>>((record, header, index) => {
      const rawValue = values[index] ?? '';
      const numericValue = Number(rawValue);
      record[header] = rawValue !== '' && Number.isFinite(numericValue) ? numericValue : rawValue;
      return record;
    }, {});
  });
};

export default function ModelTestingPage() {
  const { selectedModel } = useModelSelection();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [predictions, setPredictions] = useState<string[]>([]);
  const [testFinished, setTestFinished] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const isRunningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsedRows = parseCSV(text);
    setCsvText(text);
    setRows(parsedRows);
    setFileName(file.name);
    setTerminalLogs([]);
    setPredictions([]);
    setTestFinished(false);
    setCurrentIndex(0);
  };

  const handleRemoveFile = () => {
    setRows([]);
    setFileName('');
    setCsvText('');
    setTerminalLogs([]);
    setPredictions([]);
    setTestFinished(false);
    setCurrentIndex(0);
  };

  const runTesting = async () => {
    if (!selectedModel) {
      toast.warning('Please upload or select a model first.');
      return;
    }
    if (!rows.length) {
      toast.warning('Please upload a CSV file first.');
      return;
    }

    if (running) {
      isRunningRef.current = false;
      setRunning(false);
      return;
    }

    setRunning(true);
    isRunningRef.current = true;
    
    let startIdx = currentIndex;
    let nextLogs: string[] = [...terminalLogs];
    let nextPreds: string[] = [...predictions];

    if (testFinished || currentIndex >= rows.length) {
      startIdx = 0;
      nextLogs = [];
      nextPreds = [];
      setTerminalLogs([]);
      setPredictions([]);
      setTestFinished(false);
      setCurrentIndex(0);
    }
    
    let i = startIdx;
    for (; i < rows.length; i++) {
      if (!isRunningRef.current) {
        setCurrentIndex(i);
        break;
      }
      
      const row = rows[i];
      try {
        const response = await predictWithModelAPI(selectedModel.endpoint_url, row);
        const predObj = response.prediction as Record<string, unknown>;
        const predVal = typeof predObj === 'object' && predObj !== null ? (String(predObj.label ?? JSON.stringify(predObj))) : String(predObj);
        const confVal = typeof predObj === 'object' && predObj !== null && predObj.confidence !== undefined ? String(predObj.confidence) : 'N/A';
        
        const logMsg = `[Row ${i + 1}] Prediction: ${predVal}, Confidence: ${confVal}`;
        nextLogs.push(logMsg);
        nextPreds.push(predVal);
      } catch (error) {
        const errMsg = getApiErrorMessage(error, 'Prediction failed.');
        nextLogs.push(`[Row ${i + 1}] Error: ${errMsg}`);
        nextPreds.push('ERROR');
      }
      setTerminalLogs([...nextLogs]);
      setPredictions([...nextPreds]);
    }

    if (i >= rows.length) {
      setTestFinished(true);
      setCurrentIndex(0);
    } else {
      setCurrentIndex(i);
    }
    
    setRunning(false);
    isRunningRef.current = false;
  };

  const handleDownloadCSV = () => {
    if (rows.length === 0 || predictions.length !== rows.length) return;
    
    const headers = Object.keys(rows[0]);
    const newHeaders = [...headers, 'Prediction'];
    
    const csvContent = [
      newHeaders.join(','),
      ...rows.map((row, index) => {
        const values = headers.map(h => row[h]);
        values.push(predictions[index]);
        return values.join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `tested_${fileName}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section className="flex flex-col h-full flex-1">
      <div className="flex-1 flex flex-col rounded-lg border border-gray-300 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Data Testing</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a CSV file to test it with {selectedModel ? selectedModel.name : 'the selected model'}.
            </p>
          </div>
          <div className="flex gap-3">
            {rows.length > 0 && (
              <>
                <Button 
                  size="md" 
                  variant="danger" 
                  icon={<Trash2 className="h-4 w-4" />} 
                  onClick={handleRemoveFile}
                >
                  Remove
                </Button>
                <Button 
                  size="md" 
                  icon={<FileSpreadsheet className="h-4 w-4" />} 
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload CSV
                </Button>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(event) => {
                    void handleFileChange(event.target.files?.[0]);
                    // Reset input value so the same file can be selected again
                    event.target.value = '';
                  }}
                />
              </>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col [&>label]:flex-1">
            <FileDropzone
              accept=".csv,text/csv"
              title="Click or drag to upload test data"
              subtitle="CSV files only"
              onChange={(file) => void handleFileChange(file || undefined)}
            />
          </div>
        ) : (
          <div className="flex flex-col space-y-6">
            <div>
              <p className="mb-4 text-sm font-semibold text-gray-900">
                {fileName} · {rows.length} rows loaded
              </p>
              <div className="overflow-hidden rounded-xl border border-gray-200 h-125">
                <CSVEditor initialCsvText={csvText} readOnly={true} />
              </div>
            </div>

            {/* New Run Test Section */}
            <div className='border-t border-gray-200'>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4 mt-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Run Test</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Send the CSV file and receive the prediction results from {selectedModel ? selectedModel.name : 'the selected model'}.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button 
                    size="md" 
                    variant="secondary" 
                    icon={<Download className="h-4 w-4" />} 
                    disabled={!testFinished}
                    onClick={handleDownloadCSV}
                  >
                    Download
                  </Button>
                  <Button 
                    size="md" 
                    icon={running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} 
                    variant={running ? "danger" : "primary"}
                    onClick={runTesting}
                  >
                    {running ? "Pause" : "Run"}
                  </Button>
                </div>
              </div>
              
              <TerminalLogViewer 
                title="Testing Console"
                logsOverride={terminalLogs}
                isRunningOverride={running}
                placeholder='Click "Run" to start processing the CSV file...'
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
