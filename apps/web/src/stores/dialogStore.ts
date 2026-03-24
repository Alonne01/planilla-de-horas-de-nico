import { create } from 'zustand';

type DialogVariant = 'default' | 'danger';

interface DialogState {
  open: boolean;
  type: 'confirm' | 'alert' | 'prompt';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: DialogVariant;
  placeholder: string;
  defaultValue: string;
  inputValue: string;
  resolve: ((value: boolean | string | null) => void) | null;
}

interface DialogActions {
  confirm: (opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: DialogVariant;
  }) => Promise<boolean>;
  alert: (opts: { title?: string; message: string }) => Promise<void>;
  prompt: (opts: {
    title?: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
  }) => Promise<string | null>;
  setInputValue: (v: string) => void;
  close: (result: boolean | string | null) => void;
}

export const useDialogStore = create<DialogState & DialogActions>((set, get) => ({
  open: false,
  type: 'confirm',
  title: '',
  message: '',
  confirmLabel: 'Aceptar',
  cancelLabel: 'Cancelar',
  variant: 'default',
  placeholder: '',
  defaultValue: '',
  inputValue: '',
  resolve: null,

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        type: 'confirm',
        title: opts.title ?? 'Confirmar',
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirmar',
        cancelLabel: opts.cancelLabel ?? 'Cancelar',
        variant: opts.variant ?? 'default',
        placeholder: '',
        defaultValue: '',
        inputValue: '',
        resolve: resolve as (v: boolean | string | null) => void,
      });
    }),

  alert: (opts) =>
    new Promise<void>((resolve) => {
      set({
        open: true,
        type: 'alert',
        title: opts.title ?? 'Aviso',
        message: opts.message,
        confirmLabel: 'Aceptar',
        cancelLabel: '',
        variant: 'default',
        placeholder: '',
        defaultValue: '',
        inputValue: '',
        resolve: () => resolve(),
      });
    }),

  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      set({
        open: true,
        type: 'prompt',
        title: opts.title ?? '',
        message: opts.message,
        confirmLabel: 'Aceptar',
        cancelLabel: 'Cancelar',
        variant: 'default',
        placeholder: opts.placeholder ?? '',
        defaultValue: opts.defaultValue ?? '',
        inputValue: opts.defaultValue ?? '',
        resolve: resolve as (v: boolean | string | null) => void,
      });
    }),

  setInputValue: (v) => set({ inputValue: v }),

  close: (result) => {
    const { resolve } = get();
    set({ open: false, resolve: null });
    resolve?.(result);
  },
}));
