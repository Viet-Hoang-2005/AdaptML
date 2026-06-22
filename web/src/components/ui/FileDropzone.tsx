import { UploadCloud } from 'lucide-react';

export function FileDropzone({
  accept,
  title,
  subtitle,
  onChange,
}: {
  accept: string;
  title: string;
  subtitle: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 text-center hover:border-black">
      <UploadCloud className="mb-3 h-6 w-6 text-gray-500" />
      <span className="max-w-full truncate text-sm font-semibold text-gray-900">{title}</span>
      <span className="mt-1 text-xs text-gray-500">{subtitle}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}
