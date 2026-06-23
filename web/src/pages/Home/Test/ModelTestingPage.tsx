import { CheckCircle, Clipboard, FileSpreadsheet, Play, Pause, Terminal, XCircle, Download, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { useModelSelection } from '../../../hooks/useModelSelection';
import { predictWithModelAPI } from '../../../lib/api';
import { getApiErrorMessage } from '../../../lib/apiError';
import { toast } from '../../../lib/toast';
import { FileDropzone } from '../../../components/ui/FileDropzone';
import { CSVEditor } from '../../../components/ui/CSVEditor';

const TARGET_COLUMN_NAMES = new Set([
  'label',
  'target',
  'y',
  'class',
  'ground_truth',
  'true_label',
  'output',
  'result',
  'category',
]);

const MAX_TEST_ROWS = 50;

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

function LogTerminal({ logs }: { logs: TestLogEntry[] }) {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.scrollTop = terminal.scrollHeight;
  }, [logs]);

  const copyLogs = async () => {
    const text = logs.map((log) => `[${log.time}] ${log.level.toUpperCase()} ${log.message}${log.detail ? `\n${log.detail}` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Testing log copied.');
    } catch {
      toast.warning('Unable to copy testing log.');
    }
  };

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-gray-700" />
          <div>
            <h3 className="text-lg font-bold text-gray-900">Testing Console</h3>
            <p className="text-sm text-gray-500">Shows feature filtering, request progress, predictions, and backend errors.</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" icon={<Clipboard className="h-4 w-4" />} onClick={copyLogs} disabled={!logs.length}>
          Copy log
        </Button>
      </div>

      <div ref={terminalRef} className="max-h-115 overflow-auto rounded-lg bg-gray-950 p-4 font-mono text-xs leading-6 text-gray-100">
        {logs.length === 0 ? (
          <p className="text-gray-500">Click "Run" to start processing the CSV file...</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="mb-2">
              <span className="text-gray-500">[{log.time}]</span>{' '}
              <span
                className={
                  log.level === 'success'
                    ? 'text-emerald-300'
                    : log.level === 'warning'
                      ? 'text-amber-300'
                      : log.level === 'error'
                        ? 'text-red-300'
                        : 'text-blue-300'
                }
              >
                {log.level.toUpperCase()}
              </span>{' '}
              <span>{log.message}</span>
              {log.detail && <pre className="mt-1 whitespace-pre-wrap wrap-break-words text-gray-400">{log.detail}</pre>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  tone = 'default',
}: {
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'success' | 'warning' | 'error';
}) {
  const icon =
    tone === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> :
      tone === 'error' ? <XCircle className="h-4 w-4 text-red-600" /> :
        tone === 'warning' ? <XCircle className="h-4 w-4 text-amber-600" /> :
          <Terminal className="h-4 w-4 text-gray-500" />;

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{helper}</p>
    </div>
  );
}

export default function ModelTestingPage() {
  const { selectedModel } = useModelSelection();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [logs, setLogs] = useState<TestLogEntry[]>([]);
  const [predictions, setPredictions] = useState<string[]>([]);
  const [summary, setSummary] = useState<TestSummary>({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
  const [running, setRunning] = useState(false);
  const [testFinished, setTestFinished] = useState(false);
  const isRunningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const testingRows = Math.min(rows.length, MAX_TEST_ROWS);

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
      return;
    }

    setRunning(true);
    isRunningRef.current = true;
    setTestFinished(false);
    setPredictions([]);
    setSummary({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
    setLogs([
      makeLog('info', `Selected model: ${selectedModel.name}@${selectedModel.version || 'v1'}.`),
      makeLog('info', `Endpoint: ${selectedModel.endpoint_url}.`),
      makeLog('info', `Running prediction test for ${testingRows} row(s).`),
    ]);

    const nextSummary: TestSummary = { total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 };
    const nextPredictions: string[] = [];

    for (const [index, row] of rows.slice(0, MAX_TEST_ROWS).entries()) {
      if (!isRunningRef.current) break;

      const { features, expectedLabel } = splitRow(row);
      const featureNames = Object.keys(features);
      const rowNumber = index + 1;

      nextSummary.total += 1;
      if (expectedLabel !== undefined) nextSummary.withExpected += 1;

      pushLog(
        makeLog(
          'info',
          `Row ${rowNumber}: sending ${featureNames.length} feature(s) [${featureNames.join(', ')}].`,
          expectedLabel !== undefined ? `Expected label kept for comparison only: ${expectedLabel}` : undefined,
        ),
      );

      try {
        const response = await predictWithModelAPI(selectedModel.endpoint_url, features);
        const prediction = formatPrediction(response.prediction);
        const confidence = response.confidence == null ? '' : ` | confidence=${response.confidence}%`;
        const isCorrect = expectedLabel !== undefined && prediction.toLowerCase() === expectedLabel.toLowerCase();

        nextSummary.success += 1;
        if (expectedLabel !== undefined) {
          if (isCorrect) nextSummary.correct += 1;
          else nextSummary.mismatch += 1;
        }

        nextPredictions.push(prediction);

        pushLog(
          makeLog(
            expectedLabel === undefined || isCorrect ? 'success' : 'warning',
            `Row ${rowNumber}: predicted=${prediction}${expectedLabel !== undefined ? ` | expected=${expectedLabel}` : ''}${confidence}.`,
            expectedLabel !== undefined ? (isCorrect ? 'Result: correct.' : 'Result: mismatch.') : undefined,
          ),
        );
      } catch (error) {
        const parsedError = extractPredictionError(error);
        nextSummary.failed += 1;
        nextPredictions.push('ERROR');
        pushLog(
          makeLog(
            'error',
            `Row ${rowNumber}: request failed${parsedError.status ? ` with HTTP ${parsedError.status}` : ''} - ${parsedError.title}.`,
            parsedError.detail,
          ),
        );
      }

      setSummary({ ...nextSummary });
      setPredictions([...nextPredictions]);
    }

    pushLog(
      makeLog(
        nextSummary.failed > 0 ? 'warning' : 'success',
        `Finished: ${nextSummary.success}/${nextSummary.total} succeeded, ${nextSummary.failed} failed.`,
        nextSummary.withExpected > 0
          ? `Expected-label comparison: ${nextSummary.correct}/${nextSummary.withExpected} correct, ${nextSummary.mismatch} mismatch.`
          : undefined,
      ),
    );
    setRunning(false);
    isRunningRef.current = false;
    setTestFinished(true);
  };

  const handleDownloadCSV = () => {
    if (rows.length === 0 || predictions.length === 0) return;
    
    const headers = Object.keys(rows[0]);
    const newHeaders = [...headers, 'Prediction'];
    
    const csvContent = [
      newHeaders.join(','),
      ...rows.slice(0, MAX_TEST_ROWS).map((row, index) => {
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
              <p className="mb-4 text-sm font-semibold text-gray-900">
                {fileName} · {rows.length} rows loaded
              </p>
              <div className="overflow-hidden rounded-xl border border-gray-200 h-125">
                <CSVEditor initialCsvText={csvText} readOnly={true} />
              </div>
            </div>

            <div className='border-t border-gray-200 pt-6 space-y-6'>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
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
              
              {summary.total > 0 && (
                <div className="grid gap-3 md:grid-cols-4">
                  <SummaryCard label="Requests" value={`${summary.success}/${summary.total}`} helper="successful rows" />
                  <SummaryCard label="Failed" value={String(summary.failed)} tone={summary.failed ? 'error' : 'default'} helper="backend/API errors" />
                  <SummaryCard label="Expected labels" value={String(summary.withExpected)} helper="from label columns" />
                  <SummaryCard
                    label="Accuracy"
                    value={accuracy === null ? '-' : `${accuracy}%`}
                    tone={accuracy === null ? 'default' : summary.mismatch > 0 ? 'warning' : 'success'}
                    helper={summary.withExpected ? `${summary.correct}/${summary.withExpected} correct` : 'no labels'}
                  />
                </div>
              )}

              <LogTerminal logs={logs} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
