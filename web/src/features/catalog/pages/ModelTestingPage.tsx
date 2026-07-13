import { FileSpreadsheet, Play, Pause, Download, Trash2, SendHorizontal, X, Check, Percent } from 'lucide-react';
import { useRef, useState, useMemo, useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { TerminalLogViewer } from '@/shared/ui/TerminalLogViewer';
import { Button } from '@/shared/ui/Button';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import { predictWithModelProject } from '@/features/catalog/api/catalogApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import { FileDropzone } from '@/shared/ui/FileDropzone';
import { CSVEditor } from '@/shared/ui/CSVEditor';
import { SummaryCard } from '@/shared/ui/SummaryCard';
import { PageContent } from '@/shared/ui/PageContent';

const TARGET_COLUMN_NAMES = new Set([
  'label',
  'target',
  'y',
  'class',
  'output',
  'result',
  'category',
]);

type TestSummary = {
  total: number;
  success: number;
  failed: number;
  withExpected: number;
  correct: number;
  mismatch: number;
};

type TestLogEntry = {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
};

type PredictionErrorPayload = {
  error?: string;
  message?: string;
  hint?: string;
  received_features?: string[];
  detail?: PredictionErrorPayload | string;
};

const isTargetColumn = (name: string) => TARGET_COLUMN_NAMES.has(name.toLowerCase());

const parseCSV = (text: string) => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0]?.split(',').map((header) => header.trim().replace(/^"|"$/g, '')) ?? [];
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
    return headers.reduce<Record<string, unknown>>((record, header, index) => {
      const rawValue = values[index] ?? '';
      const numericValue = Number(rawValue);
      record[header] = rawValue !== '' && Number.isFinite(numericValue) ? numericValue : rawValue;
      return record;
    }, {});
  });
};

const splitRow = (row: Record<string, unknown>) => {
  const features: Record<string, unknown> = {};
  let expectedLabel: string | undefined;

  for (const [key, value] of Object.entries(row)) {
    if (isTargetColumn(key)) {
      if (expectedLabel === undefined) expectedLabel = String(value);
      continue;
    }
    features[key] = value;
  }

  return { features, expectedLabel };
};

const makeLog = (level: TestLogEntry['level'], message: string, detail?: string): TestLogEntry => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  time: new Date().toLocaleTimeString(),
  level,
  message,
  detail,
});

const formatPrediction = (value: unknown) => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const extractPredictionError = (error: unknown) => {
  const response = (error as { response?: { status?: number; data?: PredictionErrorPayload } })?.response;
  const rawPayload = response?.data;
  const payload = typeof rawPayload?.detail === 'object' ? rawPayload.detail : rawPayload;
  const message = payload?.message || payload?.error || getApiErrorMessage(error, 'Prediction failed.');
  const hint = payload?.hint ? `Hint: ${payload.hint}` : '';
  const received = payload?.received_features?.length ? `Received features: ${payload.received_features.join(', ')}` : '';

  return {
    status: response?.status,
    title: payload?.error || getApiErrorMessage(error, 'Prediction failed.'),
    detail: [message, received, hint].filter(Boolean).join('\n'),
  };
};



export default function ModelTestingPage() {
  const { selectedModel } = useModelSelection();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [logs, setLogs] = useState<TestLogEntry[]>([]);
  
  const stringLogs = useMemo(() => {
    return logs.map((log) => `[${log.time}] [${log.level.toUpperCase()}] ${log.message}${log.detail ? `\n${log.detail}` : ''}`);
  }, [logs]);
  const [predictions, setPredictions] = useState<string[]>([]);
  const [summary, setSummary] = useState<TestSummary>({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
  const [running, setRunning] = useState(false);
  const [testFinished, setTestFinished] = useState(false);
  const isRunningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentRowIndex, setCurrentRowIndex] = useState(0);

  const isDirty = rows.length > 0;

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return isDirty && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const pushLog = (entry: TestLogEntry) => setLogs((current) => [...current, entry]);

  const handleFileChange = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsedRows = parseCSV(text);
    const parsedTargetColumns = Object.keys(parsedRows[0] ?? {}).filter(isTargetColumn);

    setCsvText(text);
    setRows(parsedRows);
    setFileName(file.name);
    setSummary({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
    setPredictions([]);
    setTestFinished(false);
    setCurrentRowIndex(0);
    setLogs([
      makeLog('info', `Loaded ${file.name}: ${parsedRows.length} row(s).`),
      makeLog(
        parsedTargetColumns.length > 0 ? 'warning' : 'info',
        parsedTargetColumns.length > 0
          ? `Target columns will be excluded from features: ${parsedTargetColumns.join(', ')}.`
          : 'No label/target columns detected in the uploaded CSV.',
      ),
    ]);
  };

  const handleRemoveFile = () => {
    setRows([]);
    setFileName('');
    setCsvText('');
    setLogs([]);
    setPredictions([]);
    setTestFinished(false);
    setCurrentRowIndex(0);
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
    if (!selectedModel.endpoint_url) {
      toast.error('Selected model does not have a prediction endpoint.');
      return;
    }

    if (running) {
      isRunningRef.current = false;
      setRunning(false);
      pushLog(makeLog('warning', 'Testing paused by user.'));
      return;
    }

    setRunning(true);
    isRunningRef.current = true;
    
    const isStartingFresh = currentRowIndex === 0 || testFinished;
    
    let currentSummary: TestSummary;
    let currentPredictions: string[];
    
    if (isStartingFresh) {
      setCurrentRowIndex(0);
      setTestFinished(false);
      setPredictions([]);
      setSummary({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
      setLogs([
        makeLog('info', `Selected model: ${selectedModel.name}@${selectedModel.version || 'v1'}.`),
        makeLog('info', `Endpoint: ${selectedModel.endpoint_url}.`),
        makeLog('info', `Running prediction test for ${rows.length} row(s).`),
      ]);
      
      currentSummary = { total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 };
      currentPredictions = [];
    } else {
      pushLog(makeLog('info', `Resuming prediction from row ${currentRowIndex + 1}...`));
      currentSummary = { ...summary };
      currentPredictions = [...predictions];
    }

    let i = isStartingFresh ? 0 : currentRowIndex;

    for (; i < rows.length; i++) {
      if (!isRunningRef.current) break;

      const row = rows[i];
      const { features, expectedLabel } = splitRow(row);
      const rowNumber = i + 1;

      currentSummary.total += 1;
      if (expectedLabel !== undefined) currentSummary.withExpected += 1;

      try {
        const response = await predictWithModelProject(selectedModel.endpoint_url, features);
        const prediction = formatPrediction(response.prediction);
        const confidence = response.confidence == null ? '' : ` | confidence=${response.confidence}%`;
        const isCorrect = expectedLabel !== undefined && prediction.toLowerCase() === expectedLabel.toLowerCase();

        currentSummary.success += 1;
        if (expectedLabel !== undefined) {
          if (isCorrect) currentSummary.correct += 1;
          else currentSummary.mismatch += 1;
        }

        currentPredictions.push(prediction);

        pushLog(
          makeLog(
            expectedLabel === undefined || isCorrect ? 'success' : 'warning',
            `Row ${rowNumber}: Predicted=${prediction}${expectedLabel !== undefined ? ` | Expected=${expectedLabel}` : ''}${confidence} |`,
            expectedLabel !== undefined ? (isCorrect ? 'Result: correct.' : 'Result: mismatch.') : undefined,
          ),
        );
      } catch (error) {
        const parsedError = extractPredictionError(error);
        currentSummary.failed += 1;
        currentPredictions.push('ERROR');
        pushLog(
          makeLog(
            'error',
            `Row ${rowNumber}: request failed${parsedError.status ? ` with HTTP ${parsedError.status}` : ''} - ${parsedError.title}.`,
            parsedError.detail,
          ),
        );
      }

      setSummary({ ...currentSummary });
      setPredictions([...currentPredictions]);
      setCurrentRowIndex(i + 1);
    }

    if (isRunningRef.current) {
      pushLog(
        makeLog(
          currentSummary.failed > 0 ? 'warning' : 'success',
          `Finished: ${currentSummary.success}/${currentSummary.total} succeeded, ${currentSummary.failed} failed.`,
          currentSummary.withExpected > 0
            ? `Expected-label comparison: ${currentSummary.correct}/${currentSummary.withExpected} correct, ${currentSummary.mismatch} mismatch.`
            : undefined,
        ),
      );
      setRunning(false);
      isRunningRef.current = false;
      setTestFinished(true);
      setCurrentRowIndex(0);
    }
  };

  const handleDownloadCSV = () => {
    if (rows.length === 0 || predictions.length === 0) return;
    
    const headers = Object.keys(rows[0]);
    const newHeaders = [...headers, 'Prediction'];
    
    const csvContent = [
      newHeaders.join(','),
      ...rows.slice(0, predictions.length).map((row, index) => {
        const values = headers.map(h => row[h]);
        values.push(predictions[index] || '');
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

  const accuracy = summary.withExpected > 0 ? Math.round((summary.correct / summary.withExpected) * 100) : null;

  return (
    <>
      <ConfirmModal
        open={blocker.state === 'blocked'}
        title="Leave Testing Page?"
        description="You have uploaded a CSV file for testing. If you leave this page, your test data and current progress will be lost. Are you sure you want to leave?"
        tone="danger"
        confirmText="Leave"
        onConfirm={() => {
          blocker.proceed?.();
        }}
        onCancel={() => {
          blocker.reset?.();
        }}
      />
      <PageContent className="p-6 h-full">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-foreground">Data Testing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
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
                  variant="secondary"
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
              <p className="mb-4 text-sm font-semibold text-foreground">
                {fileName} · {rows.length} rows loaded
              </p>
              <div className="overflow-hidden rounded-xl border border-border h-125">
                <CSVEditor initialCsvText={csvText} readOnly={true} />
              </div>
            </div>

            <div className='border-t border-border pt-6 space-y-6'>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Run Test</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Send the CSV file and receive the prediction results from {selectedModel ? selectedModel.name : 'the selected model'}.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button 
                    size="md" 
                    variant="secondary" 
                    icon={<Download className="h-4 w-4" />} 
                    disabled={running || predictions.length === 0}
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
              
              <div className="grid gap-3 md:grid-cols-4">
                <SummaryCard 
                  label="Processed" 
                  value={`${summary.success + summary.failed}/${rows.length}`} 
                  helper="rows completed" 
                  tone={testFinished && rows.length > 0 ? 'info' : 'default'}
                  icon={<SendHorizontal className="h-4 w-4" />}
                />
                <SummaryCard 
                  label="Failed" 
                  value={String(summary.failed)} 
                  tone={summary.failed ? 'error' : 'default'} 
                  helper="backend/API errors" 
                  icon={<X className="h-4 w-4" />}
                />
                <SummaryCard 
                  label="Successful" 
                  value={String(summary.success)} 
                  tone={summary.success > 0 ? 'success' : 'default'} 
                  helper="backend/API successes" 
                  icon={<Check className="h-4 w-4" />}
                />
                <SummaryCard
                  label="Accuracy"
                  value={accuracy === null ? '-' : `${accuracy}%`}
                  tone={accuracy === null ? 'default' : summary.mismatch > 0 ? 'warning' : 'success'}
                  helper={summary.withExpected ? `${summary.correct}/${summary.withExpected} correct` : 'no labels'}
                  icon={<Percent className="h-4 w-4" />}
                />
              </div>

              <div className="mt-6">
                <TerminalLogViewer 
                  title="Testing Console" 
                  placeholder='Click "Run" to start processing the CSV file...' 
                  logsOverride={stringLogs} 
                />
              </div>
            </div>
          </div>
        )}
      </PageContent>
    </>
  );
}
