import Anser from "anser";
import { Clipboard, Terminal } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/cn";
import { toast } from "@/shared/components/toastStore";
import { Button } from "@/shared/components/Button";

function getAnsiStyle(segment: Anser.AnserJsonEntry): CSSProperties {
  const decorations = new Set(segment.decorations);
  const textDecorations = [
    decorations.has("underline") ? "underline" : "",
    decorations.has("strikethrough") ? "line-through" : "",
  ].filter(Boolean);

  return {
    color: segment.fg_truecolor || segment.fg || undefined,
    backgroundColor: segment.bg_truecolor || segment.bg || undefined,
    // typography-ignore: ANSI decorations are runtime data, not application typography.
    fontWeight: decorations.has("bold") ? 700 : undefined,
    fontStyle: decorations.has("italic") ? "italic" : undefined,
    opacity: decorations.has("dim") ? 0.7 : undefined,
    visibility: decorations.has("hidden") ? "hidden" : undefined,
    textDecoration: textDecorations.length
      ? textDecorations.join(" ")
      : undefined,
  };
}

function AnsiLogLine({ log }: { log: string }) {
  return Anser.ansiToJson(log, { remove_empty: true }).map((segment, index) => (
    <span key={`${index}-${segment.content}`} style={getAnsiStyle(segment)}>
      {segment.content}
    </span>
  ));
}

export interface TerminalViewerProps {
  title?: ReactNode;
  logs?: readonly string[];
  placeholder?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function TerminalViewer({
  title,
  logs = [],
  placeholder,
  actions,
  className,
  bodyClassName,
}: TerminalViewerProps) {
  const { t } = useTranslation("common");
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const copyLogs = async () => {
    await navigator.clipboard.writeText(logs.join("\n"));
    toast.success(t("terminal.copied"));
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-surface border border-terminal-border bg-terminal shadow-lg",
        className,
      )}
    >
      <div className="flex min-h-13 items-center border-b border-terminal-border bg-terminal-header px-4 py-3">
        <Terminal className="mr-2 h-4 w-4 shrink-0 text-color-terminal-muted" />
        <span className="truncate font-mono text-style-code-sm text-color-terminal-foreground">
          {title ?? t("terminal.title")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button
            type="button"
            onClick={() => void copyLogs()}
            variant="secondary"
            size="sm"
            title={t("terminal.copyTitle")}
            icon={<Clipboard className="h-3.5 w-3.5" />}
            className="border-terminal-border bg-terminal-header text-color-terminal-foreground hover:border-terminal-muted hover:bg-terminal-border active:bg-terminal-muted"
          >
            {t("terminal.copy")}
          </Button>
        </div>
      </div>
      <div
        ref={terminalRef}
        className={cn(
          "custom-scrollbar h-72 w-full overflow-y-auto bg-terminal p-4 font-mono text-style-terminal text-color-terminal-foreground antialiased",
          bodyClassName,
        )}
        style={{ scrollBehavior: "smooth" }}
      >
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div
              key={`${index}-${log}`}
              className="mb-1 break-all whitespace-pre-wrap"
            >
              <AnsiLogLine log={log} />
            </div>
          ))
        ) : placeholder ? (
          <div className="break-all whitespace-pre-wrap text-color-terminal-muted italic">
            {placeholder}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TerminalActionTone = "secondary" | "danger";

export interface TerminalActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: TerminalActionTone;
  loading?: boolean;
  icon?: ReactNode;
}

export function TerminalActionButton({
  tone = "secondary",
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: TerminalActionButtonProps) {
  return (
    <Button
      type="button"
      disabled={disabled}
      loading={loading}
      variant={tone}
      size="sm"
      className={className}
      icon={icon}
      {...props}
    >
      {children}
    </Button>
  );
}
