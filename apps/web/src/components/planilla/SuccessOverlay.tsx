import { useState, useEffect } from 'react';

// Pre-generated particles — deterministic per session, avoids Math.random in render
const PARTICLES = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  angle: (i / 24) * 360 + (((i * 7 + 3) % 15)),
  distance: 80 + ((i * 13 + 5) % 120),
  size: 4 + ((i * 3 + 2) % 6),
  delay: ((i * 5) % 8) / 25,
  color: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'][i % 6],
  shape: i % 3,
}));

/** Confetti + checkmark success animation overlay */
export default function SuccessOverlay({ show, onDone }: { show: boolean; onDone: () => void }) {
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit' | 'done'>('enter');

  // Animation phase timing — intentional cascading state for staged transitions
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!show) { setPhase('done'); return; }
    setPhase('enter');
    const t1 = setTimeout(() => setPhase('visible'), 50);
    const t2 = setTimeout(() => setPhase('exit'), 2000);
    const t3 = setTimeout(() => { setPhase('done'); onDone(); }, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [show, onDone]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (phase === 'done' && !show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity duration-500"
        style={{ opacity: phase === 'enter' || phase === 'done' ? 0 : phase === 'exit' ? 0 : 0.4 }}
      />

      {/* Confetti particles */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        {PARTICLES.map((p) => {
          const rad = (p.angle * Math.PI) / 180;
          const x = Math.cos(rad) * p.distance;
          const y = Math.sin(rad) * p.distance;
          return (
            <div
              key={p.id}
              className="absolute"
              style={{
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                borderRadius: p.shape === 0 ? '50%' : p.shape === 1 ? '2px' : '0',
                clipPath: p.shape === 2 ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : undefined,
                transform: phase === 'visible' || phase === 'exit'
                  ? `translate(${x}px, ${y}px) rotate(${p.angle * 2}deg) scale(${phase === 'exit' ? 0 : 1})`
                  : 'translate(0, 0) scale(0)',
                opacity: phase === 'exit' ? 0 : phase === 'visible' ? 1 : 0,
                transition: `all 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${p.delay}s`,
              }}
            />
          );
        })}
      </div>

      {/* Success card */}
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 transition-all duration-500"
        style={{
          transform: phase === 'visible' ? 'scale(1)' : phase === 'enter' ? 'scale(0.5)' : 'scale(0.8)',
          opacity: phase === 'visible' ? 1 : phase === 'enter' ? 0 : 0,
        }}
      >
        {/* Animated checkmark */}
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="w-10 h-10"
            style={{
              strokeDasharray: 30,
              strokeDashoffset: phase === 'visible' ? 0 : 30,
              transition: 'stroke-dashoffset 0.5s ease-out 0.3s',
            }}
          >
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <p className="text-lg font-semibold text-foreground">¡Planilla enviada!</p>
        <p className="text-sm text-muted-foreground">Tu planilla fue enviada para revisión</p>
      </div>
    </div>
  );
}
