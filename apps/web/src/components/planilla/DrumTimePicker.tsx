import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

const ITEM_H = 40;
const DETENT_PULL = 0.35; // 0 = free spin, 1 = locked to notches

/**
 * Mechanical-feeling pointer interaction for drum scroll containers.
 * - Click an item: smooth-scroll to it
 * - Drag: scroll with detent resistance — "notches" pull toward each item
 *   like a mechanical rotary switch
 * - Wheel & touch: native CSS scroll-snap (unaffected)
 */
function useDrumPointer(
  ref: React.RefObject<HTMLDivElement | null>,
  itemCount: number,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let startY = 0;
    let startScroll = 0;
    let moved = false;
    let capturedId = -1;

    const snapTo = (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, itemCount - 1));
      el.scrollTo({ top: clamped * ITEM_H, behavior: 'smooth' });
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      active = true;
      startY = e.clientY;
      startScroll = el.scrollTop;
      moved = false;
      capturedId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      el.style.scrollSnapType = 'none';
    };

    const onMove = (e: PointerEvent) => {
      if (!active) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 2) moved = true;

      const raw = startScroll - dy;
      // Pull toward nearest item center → mechanical detent feel
      const nearSnap = Math.round(raw / ITEM_H) * ITEM_H;
      el.scrollTop = raw + (nearSnap - raw) * DETENT_PULL;
    };

    const onUp = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      el.releasePointerCapture(capturedId);
      el.style.cursor = '';
      el.style.scrollSnapType = 'y mandatory';

      if (!moved) {
        // Click → find item under pointer and snap to it
        const rect = el.getBoundingClientRect();
        const contentY = el.scrollTop + (e.clientY - rect.top);
        const idx = Math.round((contentY - ITEM_H - ITEM_H / 2) / ITEM_H);
        snapTo(idx);
      } else {
        // Drag release → snap to nearest notch
        snapTo(Math.round(el.scrollTop / ITEM_H));
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [ref, itemCount]);
}

/**
 * Drum/scroll time picker with hour and minute wheels.
 * Minutes snap to 15-minute intervals (0, 15, 30, 45).
 * Desktop: click items to select, drag with mechanical detent feel.
 * Mobile: native touch scroll with CSS snap.
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
  const hourDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const minDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const expectedHour = useRef(currentHour);
  const expectedMin = useRef(currentMin);

  useDrumPointer(hourRef, HOURS.length);
  useDrumPointer(minRef, MINUTE_STEPS.length);

  const scrollTo = useCallback((ref: React.RefObject<HTMLDivElement | null>, index: number) => {
    if (!ref.current) return;
    ref.current.scrollTo({ top: index * ITEM_H, behavior: 'instant' });
  }, []);

  useEffect(() => {
    clearTimeout(hourDebounce.current);
    expectedHour.current = currentHour;
    scrollTo(hourRef, currentHour);
  }, [currentHour, scrollTo]);

  useEffect(() => {
    clearTimeout(minDebounce.current);
    expectedMin.current = currentMin;
    scrollTo(minRef, MINUTE_STEPS.indexOf(currentMin));
  }, [currentMin, scrollTo]);

  const handleHourScroll = () => {
    clearTimeout(hourDebounce.current);
    hourDebounce.current = setTimeout(() => {
      if (!hourRef.current) return;
      const idx = Math.round(hourRef.current.scrollTop / ITEM_H);
      const newH = HOURS[Math.min(idx, HOURS.length - 1)];
      if (newH !== expectedHour.current) {
        expectedHour.current = newH;
        onChange(`${String(newH).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`);
      }
    }, 80);
  };

  const handleMinScroll = () => {
    clearTimeout(minDebounce.current);
    minDebounce.current = setTimeout(() => {
      if (!minRef.current) return;
      const idx = Math.round(minRef.current.scrollTop / ITEM_H);
      const newM = MINUTE_STEPS[Math.min(idx, MINUTE_STEPS.length - 1)];
      if (newM !== expectedMin.current) {
        expectedMin.current = newM;
        onChange(`${String(currentHour).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
      }
    }, 80);
  };

  useEffect(() => {
    return () => {
      clearTimeout(hourDebounce.current);
      clearTimeout(minDebounce.current);
    };
  }, []);

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
