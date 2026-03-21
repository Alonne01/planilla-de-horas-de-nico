import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeName } from '@/stores/themeStore';
import { cn } from '@/lib/utils';

const bgMap: Record<ThemeName, string> = {
  concrete: '#EBF1F2',
  dark: '#0D0D0D',
  soul: '#0D0D0D',
};

export default function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="flex items-center gap-1.5 px-2">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          title={t.label}
          className={cn(
            'w-6 h-6 rounded-full border-2 transition-all duration-200 flex items-center justify-center',
            theme === t.id
              ? 'border-primary scale-110'
              : 'border-transparent hover:border-muted-foreground/50 hover:scale-105'
          )}
        >
          <span
            className="w-4 h-4 rounded-full ring-1 ring-black/10"
            style={{
              background: `linear-gradient(135deg, ${bgMap[t.id]} 50%, ${t.preview} 50%)`,
            }}
          />
        </button>
      ))}
    </div>
  );
}
