export function BuildSummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-surface border border-border bg-muted p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-all text-sm font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}
