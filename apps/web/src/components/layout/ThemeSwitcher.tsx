import { useState, useRef, useEffect } from 'react';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import { cn } from '@/lib/utils';
import { Palette, Check } from 'lucide-react';

export default function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = THEMES.find((t) => t.id === theme);

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-all duration-200',
          'hover:bg-accent/20',
          open && 'bg-accent/20'
        )}
      >
        <span
          className="w-5 h-5 rounded-full ring-1 ring-black/10 shrink-0"
          style={{
            background: `linear-gradient(135deg, ${current?.bg} 50%, ${current?.preview} 50%)`,
          }}
        />
        <span className="text-xs text-muted-foreground">{current?.label}</span>
        <Palette className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {/* Submenu */}
      <div
        className={cn(
          'absolute bottom-full right-0 mb-2 w-52 rounded-xl border border-border bg-card shadow-2xl overflow-hidden',
          'origin-bottom-right transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-75 translate-y-2 pointer-events-none'
        )}
      >
        <div className="p-1.5 space-y-0.5">
          {THEMES.map((t) => {
            const isActive = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={(e) => {
                  if (!isActive) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTheme(t.id, {
                      x: rect.left + rect.width / 2,
                      y: rect.top + rect.height / 2,
                    });
                  }
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200',
                  isActive
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'
                )}
              >
                <span
                  className="w-7 h-7 rounded-full ring-1 ring-black/10 shrink-0 transition-transform duration-200 hover:scale-110"
                  style={{
                    background: `linear-gradient(135deg, ${t.bg} 50%, ${t.preview} 50%)`,
                  }}
                />
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium text-[13px] leading-tight">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{t.description}</p>
                </div>
                {isActive && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
