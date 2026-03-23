import { cn } from '@/lib/utils';

/** Small stat card used in planilla summary grids */
export default function MiniCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-center">
      <p className={cn('text-lg font-bold font-mono', color ?? 'text-foreground')}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
