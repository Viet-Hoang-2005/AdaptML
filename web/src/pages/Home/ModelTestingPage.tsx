import { CheckCircle, Clipboard, FileSpreadsheet, Play, Terminal, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useModelSelection } from '../../hooks/useModelSelection';
import { predictWithModelAPI } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';

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
            <h3 className="text-lg font-bold text-gray-900">Testing log</h3>
            <p className="text-sm text-gray-500">Shows feature filtering, request progress, predictions, and backend errors.</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" icon={<Clipboard className="h-4 w-4" />} onClick={copyLogs} disabled={!logs.length}>
          Copy log
        </Button>
      </div>

      <div ref={terminalRef} className="max-h-[460px] overflow-auto rounded-lg bg-gray-950 p-4 font-mono text-xs leading-6 text-gray-100">
        {logs.length === 0 ? (
          <p className="text-gray-500">No test run yet. Upload a CSV file and click Run test.</p>
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
              {log.detail && <pre className="mt-1 whitespace-pre-wrap break-words text-gray-400">{log.detail}</pre>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ModelTestingPage() {
  const { selectedModel } = useModelSelection();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState('');
  const [logs, setLogs] = useState<TestLogEntry[]>([]);
  const [summary, setSummary] = useState<TestSummary>({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
  const [running, setRunning] = useState(false);

  const previewColumns = useMemo(() => Object.keys(rows[0] ?? {}).filter((column) => !isTargetColumn(column)).slice(0, 8), [rows]);
  const targetColumns = useMemo(() => Object.keys(rows[0] ?? {}).filter(isTargetColumn), [rows]);
  const testingRows = Math.min(rows.length, MAX_TEST_ROWS);

  const pushLog = (entry: TestLogEntry) => setLogs((current) => [...current, entry]);

  const handleFileChange = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsedRows = parseCSV(text);
    const parsedTargetColumns = Object.keys(parsedRows[0] ?? {}).filter(isTargetColumn);

    setRows(parsedRows);
    setFileName(file.name);
    setSummary({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
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

    setRunning(true);
    setSummary({ total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 });
    setLogs([
      makeLog('info', `Selected model: ${selectedModel.name}@${selectedModel.version || 'v1'}.`),
      makeLog('info', `Endpoint: ${selectedModel.endpoint_url}.`),
      makeLog('info', `Running prediction test for ${testingRows} row(s).`),
    ]);

    const nextSummary: TestSummary = { total: 0, success: 0, failed: 0, withExpected: 0, correct: 0, mismatch: 0 };

    for (const [index, row] of rows.slice(0, MAX_TEST_ROWS).entries()) {
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
        pushLog(
          makeLog(
            'error',
            `Row ${rowNumber}: request failed${parsedError.status ? ` with HTTP ${parsedError.status}` : ''} - ${parsedError.title}.`,
            parsedError.detail,
          ),
        );
      }

      setSummary({ ...nextSummary });
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
  };

  const accuracy = summary.withExpected > 0 ? Math.round((summary.correct / summary.withExpected) * 100) : null;

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-gray-300 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Model Testing</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a CSV file and stream prediction test logs for {selectedModel ? selectedModel.name : 'the selected model'}.
            </p>
          </div>
          <div className="flex gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-black hover:bg-gray-100">
              <FileSpreadsheet className="h-4 w-4" />
              Upload CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => void handleFileChange(event.target.files?.[0])}
              />
            </label>
            <Button size="md" icon={<Play className="h-4 w-4" />} loading={running} onClick={runTesting}>
              Run test
            </Button>
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-white p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {fileName} - {rows.length} row(s) loaded - testing first {testingRows}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Label/target columns are kept as expected labels and are not sent in prediction features.
              </p>
            </div>
            {targetColumns.length > 0 && (
              <span className="w-max rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                Excluding {targetColumns.join(', ')}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase text-gray-400">
                <tr>
                  {previewColumns.map((column) => (
                    <th key={column} className="px-3 py-2">{column}</th>
                  ))}
                  {targetColumns.map((column) => (
                    <th key={column} className="px-3 py-2 text-amber-500">{column} (expected)</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    {previewColumns.map((column) => (
                      <td key={column} className="px-3 py-2 text-gray-700">{String(row[column] ?? '')}</td>
                    ))}
                    {targetColumns.map((column) => (
                      <td key={column} className="px-3 py-2 font-medium text-amber-600">{String(row[column] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      <LogTerminal logs={logs} />
    </section>
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
