import { useToastStore } from '@/stores/toastStore';
import { cn } from '@/lib/utils';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';

const VARIANT_STYLES = {
  default: 'border-border bg-card text-foreground',
  destructive: 'border-red-500/30 bg-red-500/10 text-red-400',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
};

const VARIANT_ICONS = {
  default: null,
  destructive: AlertCircle,
  success: CheckCircle2,
};

export default function Toaster() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const Icon = VARIANT_ICONS[t.variant ?? 'default'];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto rounded-lg border p-3 shadow-lg flex items-start gap-3 animate-in slide-in-from-bottom-2 fade-in duration-200',
              VARIANT_STYLES[t.variant ?? 'default'],
            )}
          >
            {Icon && <Icon className="h-5 w-5 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cerrar notificación"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
