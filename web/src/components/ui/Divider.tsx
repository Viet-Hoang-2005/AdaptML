interface DividerProps {
  label?: string;
}

export function Divider({ label }: DividerProps) {
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 h-px bg-gray-200" />
      {label && (
        <span className="text-xs text-gray-400 font-medium shrink-0">{label}</span>
      )}
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}
