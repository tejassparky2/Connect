import { create } from 'zustand';

type Kind = 'success' | 'error' | 'info';
interface ToastState {
  message: string | null;
  kind: Kind;
  show: (message: string, kind?: Kind) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  show: (message, kind = 'info') => {
    clearTimeout(timer);
    set({ message, kind });
    timer = setTimeout(() => set({ message: null }), 3200);
  },
  hide: () => set({ message: null }),
}));

export const toast = {
  success: (m: string) => useToast.getState().show(m, 'success'),
  error: (e: unknown) => useToast.getState().show(e instanceof Error ? ((e as { fieldMessage?: string }).fieldMessage ?? e.message) : String(e), 'error'),
  info: (m: string) => useToast.getState().show(m, 'info'),
};
