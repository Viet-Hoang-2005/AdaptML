import { FileSpreadsheet, Play, Pause, Download, Terminal } from 'lucide-react';
import { useMemo, useState, useRef, useEffect } from 'react';
import { Button } from '../../components/ui/Button';
import { predictWithModelAPI } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { useModelSelection } from '../../hooks/useModelSelection';
import { FileDropzone } from '../Management/UploadModelFormPage';



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
  const [fileName, setFileName] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [predictions, setPredictions] = useState<string[]>([]);
  const [testFinished, setTestFinished] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const previewColumns = useMemo(() => Object.keys(rows[0] ?? {}).slice(0, 8), [rows]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  const handleFileChange = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsedRows = parseCSV(text);
    setRows(parsedRows);
    setFileName(file.name);
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
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-black hover:bg-gray-100 transition-colors">
                <FileSpreadsheet className="h-4 w-4" />
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => void handleFileChange(event.target.files?.[0])}
                />
              </label>
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
                {fileName} · {rows.length} rows loaded · testing first 50 rows
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-160 text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-400">
                    <tr>
                      {previewColumns.map((column) => (
                        <th key={column} className="px-4 py-3">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, index) => (
                      <tr key={index} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                        {previewColumns.map((column) => (
                          <td key={column} className="px-4 py-3 text-gray-700">{String(row[column] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              
              <div className="overflow-hidden rounded-xl bg-gray-950 shadow-inner border border-gray-800">
                <div className="flex items-center px-4 py-3 bg-gray-900 border-b border-gray-800">
                  <Terminal className="h-4 w-4 text-gray-400 mr-2" />
                  <span className="text-xs font-mono text-gray-400">Testing Console</span>
                  {running && <span className="ml-auto flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>}
                </div>
                <div 
                  ref={terminalRef}
                  className="h-72 w-full overflow-y-auto bg-gray-950 p-4 font-mono text-sm text-gray-300 custom-scrollbar"
                >
                  {terminalLogs.length === 0 ? (
                    <div className="text-gray-500 italic">Click "Run" to start processing the CSV file...</div>
                  ) : (
                    terminalLogs.map((log, i) => (
                      <div key={i} className="whitespace-pre-wrap py-0.5">{log}</div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
