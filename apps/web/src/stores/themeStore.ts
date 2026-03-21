import { create } from 'zustand';

export type ThemeName = 'concrete' | 'dark' | 'soul';

export interface ThemeOption {
  id: ThemeName;
  label: string;
  preview: string; // primary color for visual preview
}

export const THEMES: ThemeOption[] = [
  { id: 'concrete', label: 'Concrete', preview: '#73706C' },
  { id: 'dark', label: 'Dark', preview: '#734D49' },
  { id: 'soul', label: 'Soul', preview: '#898C26' },
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

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

// Apply the saved theme on load
applyTheme(getInitialTheme());
