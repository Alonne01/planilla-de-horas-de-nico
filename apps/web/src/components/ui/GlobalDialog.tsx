import { useEffect, useRef } from 'react';
import { useDialogStore } from '@/stores/dialogStore';
import { cn } from '@/lib/utils';
import { AlertTriangle, Info, X } from 'lucide-react';

export default function GlobalDialog() {
  const { open, type, title, message, confirmLabel, cancelLabel, variant, placeholder, inputValue, setInputValue, close } =
    useDialogStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (type === 'prompt') inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, type]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close(type === 'alert' ? true : type === 'prompt' ? null : false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, type, close]);

  if (!open) return null;

  const handleConfirm = () => {
    if (type === 'confirm') close(true);
    else if (type === 'alert') close(true);
    else close(inputValue);
  };

  const handleCancel = () => {
    close(type === 'prompt' ? null : false);
  };

  const isDanger = variant === 'danger';
  const Icon = isDanger ? AlertTriangle : Info;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="flex items-start gap-3 p-4 pb-2">
          <div className={cn(
            'p-2 rounded-lg mt-0.5 shrink-0',
            isDanger ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary'
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            {title && (
              <h3 id="dialog-title" className="text-sm font-semibold text-foreground">
                {title}
              </h3>
            )}
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{message}</p>
          </div>
          {type !== 'alert' && (
            <button onClick={handleCancel} className="p-1 rounded-lg hover:bg-accent text-muted-foreground shrink-0">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {type === 'prompt' && (
          <div className="px-4 pt-1 pb-2">
            <input
              ref={inputRef}
              type="text"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 p-4 pt-3">
          {type !== 'alert' && (
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={handleConfirm}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              isDanger
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
