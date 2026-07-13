import { Clipboard, X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { useTranslation } from 'react-i18next';

interface ApiModalProps {
  title: string;
  description: string;
  apiKey: string;
  onClose: () => void;
  onCopy: () => void;
}

export function ApiModal({ title, description, apiKey, onClose, onCopy }: ApiModalProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('avatarDialog.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {description}
          </div>
          <div className="mt-4 rounded-lg border border-border bg-muted p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiDialog.label')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-3 py-2 text-sm font-semibold text-foreground">
                {apiKey}
              </code>
              <button
                type="button"
                onClick={onCopy}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:text-foreground"
                aria-label={t('apiDialog.copy')}
              >
                <Clipboard className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={onClose}>{t('apiDialog.done')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
