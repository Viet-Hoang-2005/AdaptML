export function TextArea({
  id,
  label,
  value,
  onChange,
  placeholder,
  minHeight = 'min-h-24',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minHeight?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${minHeight} w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors hover:border-black focus:border-black`}
        placeholder={placeholder}
      />
    </div>
  );
}
