import { FileSpreadsheet, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { predictWithModelAPI } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toast';
import { useModelSelection } from '../../hooks/useModelSelection';

type TestResult = {
  row: number;
  prediction?: unknown;
  error?: string;
};

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
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const previewColumns = useMemo(() => Object.keys(rows[0] ?? {}).slice(0, 8), [rows]);

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
      try {
        const response = await predictWithModelAPI(selectedModel.endpoint_url, row);
        nextResults.push({ row: index + 1, prediction: response.prediction });
      } catch (error) {
        nextResults.push({ row: index + 1, error: getApiErrorMessage(error, 'Prediction failed.') });
      }
      setResults([...nextResults]);
    }

    setRunning(false);
  };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-gray-300 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Model Testing</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a CSV file and send rows to {selectedModel ? selectedModel.name : 'the selected model'}.
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
          <p className="mb-4 text-sm font-semibold text-gray-900">
            {fileName} · {rows.length} rows loaded · testing first 50 rows
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase text-gray-400">
                <tr>
                  {previewColumns.map((column) => (
                    <th key={column} className="px-3 py-2">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    {previewColumns.map((column) => (
                      <td key={column} className="px-3 py-2 text-gray-700">{String(row[column] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-white p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-900">Prediction results</h3>
          <div className="space-y-2">
            {results.map((result) => (
              <div key={result.row} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-semibold text-gray-700">Row {result.row}</span>
                <span className={result.error ? 'text-red-600' : 'text-gray-900'}>
                  {result.error ?? JSON.stringify(result.prediction)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
