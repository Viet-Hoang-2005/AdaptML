interface DividerProps {
  label?: string;
}

export function Divider({ label }: DividerProps) {
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="h-px flex-1 bg-border" />
      {label && (
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      )}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
