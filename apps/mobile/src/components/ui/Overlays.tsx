import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useToast } from '@/lib/toast';
import { Button, Icon, type IconName } from './index';

// ─────────────── Toast ───────────────

export function ToastHost() {
  const { message, kind, hide } = useToast();
  const insets = useSafeAreaInsets();
  if (!message) return null;
  const bg = kind === 'error' ? 'bg-alert-600' : kind === 'success' ? 'bg-brand-700' : 'bg-ink-900';
  const icon: IconName = kind === 'error' ? 'alert-circle' : kind === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 8, zIndex: 1000 }} className="items-center px-4">
      <Pressable testID="toast" onPress={hide} className={`w-full max-w-md flex-row items-center rounded-2xl px-4 py-3 ${bg}`} style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 }}>
        <Icon name={icon} size={20} color="#fff" />
        <Text className="ml-2 flex-1 text-sm font-medium text-white">{message}</Text>
      </Pressable>
    </View>
  );
}

// ─────────────── Confirm dialog (Alert.alert is a no-op on web) ───────────────

interface ConfirmReq {
  title: string;
  message?: string;
  confirmText?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}
const useConfirm = create<{ req: ConfirmReq | null; set: (r: ConfirmReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirm(title: string, message?: string, opts: { confirmText?: string; destructive?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => useConfirm.getState().set({ title, message, ...opts, resolve }));
}

export function ConfirmHost() {
  const { req, set } = useConfirm();
  const close = (ok: boolean) => {
    req?.resolve(ok);
    set(null);
  };
  return (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={() => close(false)}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-8" onPress={() => close(false)}>
        <Pressable className="w-full max-w-sm rounded-3xl bg-white p-6" onPress={() => undefined}>
          <Text className="text-lg font-bold text-ink-900">{req?.title}</Text>
          {req?.message ? <Text className="mt-2 text-sm leading-5 text-ink-600">{req.message}</Text> : null}
          <View className="mt-6 flex-row">
            <Button title="Cancel" variant="outline" className="mr-2 flex-1" onPress={() => close(false)} testID="confirm-cancel" />
            <Button title={req?.confirmText ?? 'OK'} variant={req?.destructive ? 'danger' : 'primary'} className="flex-1" onPress={() => close(true)} testID="confirm-ok" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────── Action sheet ───────────────

export interface SheetAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
}
const useSheet = create<{ actions: SheetAction[] | null; title?: string; open: (a: SheetAction[], title?: string) => void; close: () => void }>((set) => ({
  actions: null,
  open: (actions, title) => set({ actions, title }),
  close: () => set({ actions: null }),
}));
export const openSheet = (actions: SheetAction[], title?: string) => useSheet.getState().open(actions, title);

export function SheetHost() {
  const { actions, title, close } = useSheet();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!actions} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={close}>
        <Pressable onPress={() => undefined} className="rounded-t-3xl bg-white px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-ink-200" />
          {title ? <Text className="mb-2 px-2 text-sm font-semibold text-ink-500">{title}</Text> : null}
          {actions?.map((a) => (
            <Pressable
              key={a.label}
              testID={`sheet-${a.label}`}
              onPress={() => {
                close();
                setTimeout(a.onPress, 50);
              }}
              className="flex-row items-center rounded-2xl px-2 py-3.5 active:bg-ink-50"
            >
              <Icon name={a.icon} size={20} color={a.destructive ? '#DC2626' : '#334155'} />
              <Text className={`ml-3 text-base font-medium ${a.destructive ? 'text-alert-600' : 'text-ink-800'}`}>{a.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
