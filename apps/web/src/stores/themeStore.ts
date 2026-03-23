import { create } from 'zustand';

export type ThemeName = 'concrete' | 'dark' | 'soul' | 'elden' | 'yoco';

export interface ThemeOption {
  id: ThemeName;
  label: string;
  preview: string;   // primary color for visual preview
  bg: string;        // background color for preview
  description: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'concrete', label: 'Concrete', preview: '#73706C', bg: '#EBF1F2', description: 'Claro, minimalista' },
  { id: 'yoco', label: 'Yoco', preview: '#F29F05', bg: '#FDF8EE', description: 'Claro, girasol/cálido' },
  { id: 'dark', label: 'Dark', preview: '#734D49', bg: '#0D0D0D', description: 'Oscuro, cálido' },
  { id: 'soul', label: 'Soul', preview: '#898C26', bg: '#0D0D0D', description: 'Oscuro, teal/oliva' },
  { id: 'elden', label: 'Elden', preview: '#C8AA6E', bg: '#0E0C08', description: 'Oscuro, dorado/ámbar' },
];

const STORAGE_KEY = 'planilla-theme';

function getInitialTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) {
      return stored as ThemeName;
    }
  } catch {
    // localStorage unavailable
  }
  // Respect OS color scheme preference on first visit
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'concrete';
  }
  return 'dark';
}

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
}

/** Spawn an elegant circular reveal from a point, then apply the new theme */
export function applyThemeWithRipple(theme: ThemeName, origin?: { x: number; y: number }) {
  const target = THEMES.find((t) => t.id === theme);
  if (!target) return;

  // If View Transitions API is available, use it for a native-feeling transition
  if (document.startViewTransition) {
    const cx = origin?.x ?? window.innerWidth / 2;
    const cy = origin?.y ?? window.innerHeight / 2;
    const maxDist = Math.hypot(
      Math.max(cx, window.innerWidth - cx),
      Math.max(cy, window.innerHeight - cy),
    );

    const transition = document.startViewTransition(() => {
      applyTheme(theme);
    });

    transition.ready.then(() => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${cx}px ${cy}px)`,
            `circle(${maxDist}px at ${cx}px ${cy}px)`,
          ],
        },
        {
          duration: reducedMotion ? 0 : 600,
          easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    });
    return;
  }

  // Fallback for browsers without View Transitions API
  const cx = origin?.x ?? window.innerWidth / 2;
  const cy = origin?.y ?? window.innerHeight / 2;
  const maxDist = Math.hypot(
    Math.max(cx, window.innerWidth - cx),
    Math.max(cy, window.innerHeight - cy),
  );

  // Create overlay with current page snapshot
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    pointer-events: none;
    background: var(--background);
    transition: clip-path 0.6s cubic-bezier(0.22, 0.61, 0.36, 1);
    clip-path: circle(${maxDist + 100}px at ${cx}px ${cy}px);
  `;
  document.body.appendChild(overlay);

  // Apply the new theme underneath
  requestAnimationFrame(() => {
    applyTheme(theme);
    requestAnimationFrame(() => {
      overlay.style.clipPath = `circle(0px at ${cx}px ${cy}px)`;
      overlay.addEventListener('transitionend', () => overlay.remove());
      setTimeout(() => overlay.remove(), 800);
    });
  });
}

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName, origin?: { x: number; y: number }) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),
  setTheme: (theme, origin) => {
    applyThemeWithRipple(theme, origin);
    set({ theme });
  },
}));

// Apply the saved theme on load
applyTheme(getInitialTheme());
