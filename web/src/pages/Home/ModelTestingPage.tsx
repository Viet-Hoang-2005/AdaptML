import { ChevronDown, ChevronUp, FileSpreadsheet, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { predictWithModelAPI } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { useModelSelection } from '../../hooks/useModelSelection';

// Common label/target column names to exclude from prediction features (case-insensitive).
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

const isTargetColumn = (name: string) => TARGET_COLUMN_NAMES.has(name.toLowerCase());

type TestResult = {
  row: number;
  prediction?: unknown;
  confidence?: number | null;
  expectedLabel?: string;
  error?: string;
  errorDetail?: string;
  isFeatureMismatch?: boolean;
};

const parseCSV = (text: string) => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0]?.split(',').map((h) => h.trim().replace(/^"|"$/g, '')) ?? [];
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return headers.reduce<Record<string, unknown>>((rec, header, i) => {
      const raw = values[i] ?? '';
      const num = Number(raw);
      rec[header] = raw !== '' && Number.isFinite(num) ? num : raw;
      return rec;
    }, {});
  });
};

/** Split a CSV row into { features, expectedLabel }. */
const splitRow = (row: Record<string, unknown>) => {
  const features: Record<string, unknown> = {};
  let expectedLabel: string | undefined;
  for (const [k, v] of Object.entries(row)) {
    if (isTargetColumn(k)) {
      // Keep only the first target column found as expected label.
      if (expectedLabel === undefined) expectedLabel = String(v);
    } else {
      features[k] = v;
    }
  }
  return { features, expectedLabel };
};

function ResultRow({ result }: { result: TestResult }) {
  const [expanded, setExpanded] = useState(false);

  const isCorrect =
    result.expectedLabel !== undefined &&
    result.prediction !== undefined &&
    String(result.prediction).toLowerCase() === result.expectedLabel.toLowerCase();

  const hasBadge = result.expectedLabel !== undefined && result.prediction !== undefined;

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-4">
        <span className="shrink-0 font-semibold text-gray-500">Row {result.row}</span>

        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          {result.error ? (
            <span className="font-medium text-red-600">
              {result.isFeatureMismatch
                ? 'Invalid input columns - label/target column may be included as feature.'
                : result.error}
            </span>
          ) : (
            <>
              <span className="text-gray-900">
                <span className="text-gray-500">Predicted: </span>
                <span className="font-semibold">{String(result.prediction)}</span>
              </span>
              {result.expectedLabel !== undefined && (
                <span className="text-gray-700">
                  <span className="text-gray-500">Expected: </span>
                  <span className="font-medium">{result.expectedLabel}</span>
                </span>
              )}
              {result.confidence != null && (
                <span className="text-gray-500">Confidence: {result.confidence}%</span>
              )}
              {hasBadge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isCorrect
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {isCorrect ? 'Correct' : 'Mismatch'}
                </span>
              )}
            </>
          )}
        </div>

        {(result.errorDetail || (result.error && !result.isFeatureMismatch)) && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Toggle details"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {expanded && result.errorDetail && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700 whitespace-pre-wrap">
          {result.errorDetail}
        </pre>
      )}
    </div>
  );
}

export default function ModelTestingPage() {
  const { selectedModel } = useModelSelection();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  // Columns that are NOT target columns, for preview table.
  const previewColumns = useMemo(
    () => Object.keys(rows[0] ?? {}).filter((c) => !isTargetColumn(c)).slice(0, 8),
    [rows],
  );
  const targetColumns = useMemo(
    () => Object.keys(rows[0] ?? {}).filter(isTargetColumn),
    [rows],
  );

  const handleFileChange = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsedRows = parseCSV(text);
    setRows(parsedRows);
    setFileName(file.name);
    setResults([]);
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

    setRunning(true);
    const nextResults: TestResult[] = [];
    const sampleRows = rows.slice(0, 50);

    for (const [index, row] of sampleRows.entries()) {
      const { features, expectedLabel } = splitRow(row);
      try {
        const response = await predictWithModelAPI(selectedModel.endpoint_url, features);
        nextResults.push({
          row: index + 1,
          prediction: response.prediction,
          confidence: response.confidence ?? null,
          expectedLabel,
        });
      } catch (error) {
        // Check if the server returned a structured 400 about feature columns.
        const axiosError = error as { response?: { status?: number; data?: { error?: string; hint?: string; message?: string } } };
        const status = axiosError?.response?.status;
        const detail = axiosError?.response?.data;
        const isFeatureMismatch =
          status === 400 && typeof detail?.error === 'string' && detail.error === 'Invalid feature columns';

        nextResults.push({
          row: index + 1,
          expectedLabel,
          error: getApiErrorMessage(error, 'Prediction failed.'),
          errorDetail: isFeatureMismatch
            ? `${detail?.message ?? ''}\n\nHint: ${detail?.hint ?? ''}`
            : undefined,
          isFeatureMismatch,
        });
      }
      setResults([...nextResults]);
    }

    setRunning(false);
  };

  const correctCount = results.filter(
    (r) => !r.error && r.expectedLabel !== undefined && String(r.prediction).toLowerCase() === r.expectedLabel.toLowerCase(),
  ).length;
  const withExpected = results.filter((r) => !r.error && r.expectedLabel !== undefined).length;

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-300 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Model Testing</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a CSV file and send rows to{' '}
              {selectedModel ? <span className="font-medium">{selectedModel.name}</span> : 'the selected model'}.
              Label/target columns are automatically excluded from prediction input.
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
                onChange={(e) => void handleFileChange(e.target.files?.[0])}
              />
            </label>
            <Button size="md" icon={<Play className="h-4 w-4" />} loading={running} onClick={runTesting}>
              Run test
            </Button>
          </div>
        </div>
      </div>

      {/* CSV Preview */}
      {rows.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-white p-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-gray-900">
              {fileName} - {rows.length} rows loaded - testing first 50 rows
            </p>
            {targetColumns.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                Auto-excluding: {targetColumns.join(', ')}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase text-gray-400">
                <tr>
                  {previewColumns.map((col) => (
                    <th key={col} className="px-3 py-2">{col}</th>
                  ))}
                  {targetColumns.map((col) => (
                    <th key={col} className="px-3 py-2 text-amber-400">{col} (label)</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {previewColumns.map((col) => (
                      <td key={col} className="px-3 py-2 text-gray-700">{String(row[col] ?? '')}</td>
                    ))}
                    {targetColumns.map((col) => (
                      <td key={col} className="px-3 py-2 text-amber-500 italic">{String(row[col] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900">Prediction results</h3>
            {withExpected > 0 && (
              <span className="text-sm text-gray-500">
                Accuracy:{' '}
                <span className="font-semibold text-gray-800">
                  {correctCount}/{withExpected} ({Math.round((correctCount / withExpected) * 100)}%)
                </span>
              </span>
            )}
          </div>
          <div className="space-y-2">
            {results.map((result) => (
              <ResultRow key={result.row} result={result} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
