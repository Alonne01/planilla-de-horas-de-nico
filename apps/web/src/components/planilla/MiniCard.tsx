import { cn } from '@/lib/utils';
import { useCountUp } from '@/hooks/useCountUp';

/**
 * Small stat card used in planilla summary grids.
 * Si se pasa `animate` (número), el valor hace count-up con easing (port PWA); si no, muestra `value`.
 * `glow` agrega un resplandor creciente al número (para el total de horas).
 */
export default function MiniCard({
  label,
  value,
  color,
  animate,
  decimals = 1,
  suffix = '',
  glow = false,
}: {
  label: string;
  value?: string;
  color?: string;
  animate?: number;
  decimals?: number;
  suffix?: string;
  glow?: boolean;
}) {
  const counted = useCountUp(animate ?? 0);
  const display = animate !== undefined ? counted.toFixed(decimals) + suffix : (value ?? '');
  const glowStyle =
    glow && animate !== undefined
      ? {
          textShadow: `0 0 ${Math.min(animate / 200, 1) * 14}px color-mix(in srgb, var(--primary) 70%, transparent)`,
        }
      : undefined;

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-center">
      <p className={cn('text-lg font-bold font-mono tabular-nums', color ?? 'text-foreground')} style={glowStyle}>
        {display}
      </p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
