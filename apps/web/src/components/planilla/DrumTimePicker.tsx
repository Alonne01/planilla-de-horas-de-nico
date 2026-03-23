import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

/** Enable mouse-drag scrolling on a scroll container (desktop UX). */
function useDragScroll(ref: React.RefObject<HTMLDivElement | null>) {
  const drag = useRef({ active: false, startY: 0, startScroll: 0, moved: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // let native touch scroll handle it
      drag.current = { active: true, startY: e.clientY, startScroll: el.scrollTop, moved: false };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.current.active) return;
      const dy = e.clientY - drag.current.startY;
      if (Math.abs(dy) > 3) drag.current.moved = true;
      el.scrollTop = drag.current.startScroll - dy;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag.current.active) return;
      drag.current.active = false;
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = '';
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
  }, [ref]);

  return drag;
}

/**
 * Mobile-friendly drum/scroll time picker with hour and minute wheels.
 * Minutes snap to 15-minute intervals (0, 15, 30, 45).
 * Desktop: click items to select, drag to scroll.
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

  const ITEM_H = 40;

  const hourDrag = useDragScroll(hourRef);
  const minDrag = useDragScroll(minRef);

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

  const clickHour = (hr: number) => {
    if (hourDrag.current.moved) return; // was a drag, not a click
    expectedHour.current = hr;
    scrollTo(hourRef, hr);
    onChange(`${String(hr).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`);
  };

  const clickMin = (mn: number) => {
    if (minDrag.current.moved) return;
    expectedMin.current = mn;
    scrollTo(minRef, MINUTE_STEPS.indexOf(mn));
    onChange(`${String(currentHour).padStart(2, '0')}:${String(mn).padStart(2, '0')}`);
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
        style={{ scrollbarWidth: 'none', touchAction: 'pan-y' }}
      >
        <div style={{ height: ITEM_H }} />
        {HOURS.map((hr) => (
          <div
            key={hr}
            onClick={() => clickHour(hr)}
            className={cn(
              'flex items-center justify-center snap-center h-10 text-lg font-mono transition-colors select-none',
              hr === currentHour ? 'text-primary font-bold text-xl' : 'text-muted-foreground hover:text-foreground cursor-pointer',
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
        style={{ scrollbarWidth: 'none', touchAction: 'pan-y' }}
      >
        <div style={{ height: ITEM_H }} />
        {MINUTE_STEPS.map((mn) => (
          <div
            key={mn}
            onClick={() => clickMin(mn)}
            className={cn(
              'flex items-center justify-center snap-center h-10 text-lg font-mono transition-colors select-none',
              mn === currentMin ? 'text-primary font-bold text-xl' : 'text-muted-foreground hover:text-foreground cursor-pointer',
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
