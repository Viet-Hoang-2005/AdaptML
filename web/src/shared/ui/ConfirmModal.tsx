import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle, Info } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Button } from './Button';

type ConfirmTone = 'default' | 'danger';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const danger = tone === 'danger';
  const confirmedRef = useRef(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) return;
      if (confirmedRef.current) {
        confirmedRef.current = false;
        return;
      }
      onCancel();
    }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm animate-fade-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 text-foreground shadow-[var(--shadow-overlay)] animate-fade-in">
          <div className="flex items-start gap-4">
            <span className={danger ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger-subtle text-danger' : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'}>
              {danger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <AlertDialog.Title className="text-lg font-semibold text-foreground">{title}</AlertDialog.Title>
              <AlertDialog.Description asChild>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>
              </AlertDialog.Description>
            </div>
          </div>
          <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild><Button variant="secondary">{cancelText}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={() => { confirmedRef.current = true; onConfirm(); }}>{confirmText}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
