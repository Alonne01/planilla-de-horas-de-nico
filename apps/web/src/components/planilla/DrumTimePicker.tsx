import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * Mobile-friendly drum/scroll time picker with hour and minute wheels.
 * Minutes snap to 15-minute intervals (0, 15, 30, 45).
 */
export default function DrumTimePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const MINUTE_STEPS = [0, 15, 30, 45];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  const [h, m] = value.split(':').map(Number);
  const currentHour = isNaN(h) ? 7 : h;
  const currentMin = isNaN(m) ? 0 : Math.round(m / 15) * 15 % 60;

  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);
  // Guard against scroll events fired during programmatic scrollTo animations
  const isProgrammatic = useRef(false);

  const ITEM_H = 40;

  const scrollTo = useCallback((ref: React.RefObject<HTMLDivElement | null>, index: number) => {
    if (!ref.current) return;
    isProgrammatic.current = true;
    ref.current.scrollTo({ top: index * ITEM_H, behavior: 'smooth' });
    // Clear after animation settles (smooth scroll ~300ms)
    setTimeout(() => { isProgrammatic.current = false; }, 350);
  }, []);

  useEffect(() => { scrollTo(hourRef, currentHour); }, [currentHour, scrollTo]);
  useEffect(() => { scrollTo(minRef, MINUTE_STEPS.indexOf(currentMin)); }, [currentMin, scrollTo]);

  const handleHourScroll = () => {
    if (isProgrammatic.current || !hourRef.current) return;
    const idx = Math.round(hourRef.current.scrollTop / ITEM_H);
    const newH = HOURS[Math.min(idx, HOURS.length - 1)];
    if (newH !== currentHour) onChange(`${String(newH).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`);
  };

  const handleMinScroll = () => {
    if (isProgrammatic.current || !minRef.current) return;
    const idx = Math.round(minRef.current.scrollTop / ITEM_H);
    const newM = MINUTE_STEPS[Math.min(idx, MINUTE_STEPS.length - 1)];
    if (newM !== currentMin) onChange(`${String(currentHour).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
  };

  if (disabled) {
    return (
      <div className="flex items-center justify-center h-10 px-3 rounded-lg border border-input bg-muted/30 text-sm font-mono text-muted-foreground">
        {String(currentHour).padStart(2, '0')}:{String(currentMin).padStart(2, '0')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 justify-center">
      {/* Hour drum */}
      <div
        ref={hourRef}
        onScroll={handleHourScroll}
        className="h-[120px] overflow-y-scroll snap-y snap-mandatory scrollbar-none rounded-lg border border-input bg-background text-foreground relative w-16 cursor-grab"
        style={{ scrollbarWidth: 'none' }}
      >
        <div style={{ height: ITEM_H }} />
        {HOURS.map((hr) => (
          <div
            key={hr}
            className={cn(
              'flex items-center justify-center snap-center h-10 text-lg font-mono transition-colors select-none',
              hr === currentHour ? 'text-primary font-bold text-xl' : 'text-muted-foreground',
            )}
          >
            {String(hr).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>

      <span className="text-xl font-bold text-foreground">:</span>

      {/* Minute drum */}
      <div
        ref={minRef}
        onScroll={handleMinScroll}
        className="h-[120px] overflow-y-scroll snap-y snap-mandatory scrollbar-none rounded-lg border border-input bg-background text-foreground relative w-16 cursor-grab"
        style={{ scrollbarWidth: 'none' }}
      >
        <div style={{ height: ITEM_H }} />
        {MINUTE_STEPS.map((mn) => (
          <div
            key={mn}
            className={cn(
              'flex items-center justify-center snap-center h-10 text-lg font-mono transition-colors select-none',
              mn === currentMin ? 'text-primary font-bold text-xl' : 'text-muted-foreground',
            )}
          >
            {String(mn).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>
    </div>
  );
}
