import { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface CSVEditorProps {
  initialCsvText: string;
  onChange?: (csvText: string) => void;
  readOnly?: boolean;
}

export function CSVEditor({ initialCsvText, onChange, readOnly = false }: CSVEditorProps) {
  const [data, setData] = useState<string[][]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 100;

  useEffect(() => {
    // Parse initial CSV
    Papa.parse<string[]>(initialCsvText, {
      complete: (results) => {
        setData(results.data);
      },
      skipEmptyLines: true,
    });
  }, [initialCsvText]);

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    if (readOnly || !onChange) return;
    const newData = [...data];
    if (!newData[rowIndex]) {
      newData[rowIndex] = [];
    }
    newData[rowIndex][colIndex] = value;
    setData(newData);
    
    // Unparse and trigger onChange
    const newCsvText = Papa.unparse(newData);
    onChange(newCsvText);
  };

  const totalPages = Math.ceil(data.length / pageSize);
  const paginatedData = useMemo(() => {
    return data.slice(page * pageSize, (page + 1) * pageSize);
  }, [data, page]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <p>No CSV data</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="flex items-center justify-end p-2 border-b border-gray-200">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Row {page * pageSize + 1} - {Math.min((page + 1) * pageSize, data.length)} of {data.length}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        <table className="min-w-full divide-y divide-gray-200 border-collapse">
          <tbody className="divide-y divide-gray-200 bg-white">
            {paginatedData.map((row, pRowIndex) => {
              const actualRowIndex = page * pageSize + pRowIndex;
              const isHeader = actualRowIndex === 0;
              return (
                <tr key={actualRowIndex} className={isHeader ? "bg-gray-50 sticky top-0 z-10" : "hover:bg-gray-50"}>
                  <td className="w-12 px-2 py-1 text-xs text-gray-400 bg-gray-50 border-r border-b text-center sticky left-0 z-20">
                    {actualRowIndex + 1}
                  </td>
                  {row.map((cell, colIndex) => (
                    <td key={colIndex} className="border-r border-b border-gray-200 p-0 min-w-25">
                      <input
                        type="text"
                        value={cell || ''}
                        onChange={(e) => handleCellChange(actualRowIndex, colIndex, e.target.value)}
                        readOnly={readOnly}
                        className={`w-full px-3 py-2 text-sm bg-transparent outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${isHeader ? 'font-bold text-gray-900' : 'text-gray-700'}`}
                        placeholder={isHeader ? `Column ${colIndex + 1}` : ''}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
