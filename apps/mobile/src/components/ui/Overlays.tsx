/**
 * In-window overlays (toast, confirm dialog, action sheet, bottom sheet).
 *
 * Why not <Modal>? A native Modal opens its own window: anything rendered in the
 * app root (e.g. toasts) is hidden behind it, and on iOS presenting a second
 * Modal while the first is still dismissing silently fails. Rendering overlays
 * inside the app's own window avoids both problems. On iOS the toast host is
 * wrapped in react-native-screens' FullWindowOverlay so it also sits above
 * natively-presented screens (the post composer modal).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useToast } from '@/lib/toast';
import { Button, Icon, type IconName } from './index';

// ─────────────── Bottom sheet primitive ───────────────

export function BottomSheet({ visible, onClose, children, testID }: { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, anim]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)', opacity: anim }]}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          // Plain styles (not className): NativeWind classes on Animated.View are dropped on web.
          style={{
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            paddingBottom: insets.bottom + 12,
            maxHeight: '92%',
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 12,
          }}
        >
          <View className="mb-3 h-1.5 w-10 self-center rounded-full bg-ink-200" />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─────────────── Toast ───────────────

function ToastView() {
  const { message, kind, hide } = useToast();
  const insets = useSafeAreaInsets();
  if (!message) return null;
  const bg = kind === 'error' ? 'bg-alert-600' : kind === 'success' ? 'bg-brand-700' : 'bg-ink-900';
  const icon: IconName = kind === 'error' ? 'alert-circle' : kind === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 8, zIndex: 1000 }} className="items-center px-4">
      <Pressable
        testID="toast"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={hide}
        className={`w-full max-w-md flex-row items-center rounded-2xl px-4 py-3 ${bg}`}
        style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 }}
      >
        <Icon name={icon} size={20} color="#fff" />
        <Text className="ml-2 flex-1 text-sm font-medium text-white">{message}</Text>
      </Pressable>
    </View>
  );
}

export function ToastHost() {
  const message = useToast((s) => s.message);
  if (Platform.OS === 'ios' && message) {
    return (
      <FullWindowOverlay>
        <ToastView />
      </FullWindowOverlay>
    );
  }
  return <ToastView />;
}

// ─────────────── Confirm dialog ───────────────

interface ConfirmReq {
  title: string;
  message?: string;
  confirmText?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}
const useConfirm = create<{ req: ConfirmReq | null; set: (r: ConfirmReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirm(title: string, message?: string, opts: { confirmText?: string; destructive?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // A newer confirm supersedes an unanswered one (resolve it as cancelled so callers never hang).
    useConfirm.getState().req?.resolve(false);
    useConfirm.getState().set({ title, message, ...opts, resolve });
  });
}

export function ConfirmHost() {
  const { req, set } = useConfirm();
  const close = (ok: boolean) => {
    req?.resolve(ok);
    set(null);
  };
  useEffect(() => {
    if (!req) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      req.resolve(false);
      set(null);
      return true;
    });
    return () => sub.remove();
  }, [req, set]);
  if (!req) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 900 }]} className="items-center justify-center bg-black/40 px-8">
      <Pressable accessibilityLabel="Cancel" style={StyleSheet.absoluteFill} onPress={() => close(false)} />
      <View accessibilityRole="alert" className="w-full max-w-sm rounded-3xl bg-white p-6">
        <Text className="text-lg font-bold text-ink-900">{req.title}</Text>
        {req.message ? <Text className="mt-2 text-sm leading-5 text-ink-600">{req.message}</Text> : null}
        <View className="mt-6 flex-row">
          <Button title="Cancel" variant="outline" className="mr-2 flex-1" onPress={() => close(false)} testID="confirm-cancel" />
          <Button title={req.confirmText ?? 'OK'} variant={req.destructive ? 'danger' : 'primary'} className="flex-1" onPress={() => close(true)} testID="confirm-ok" />
        </View>
      </View>
    </View>
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
  const last = useRef<{ actions: SheetAction[]; title?: string } | null>(null);
  if (actions) last.current = { actions, title }; // keep content during the close animation
  const shown = actions ?? last.current?.actions ?? [];
  return (
    <BottomSheet visible={!!actions} onClose={close}>
      {(actions ? title : last.current?.title) ? <Text className="mb-2 px-2 text-sm font-semibold text-ink-500">{actions ? title : last.current?.title}</Text> : null}
      {shown.map((a) => (
        <Pressable
          key={a.label}
          testID={`sheet-${a.label}`}
          accessibilityRole="button"
          onPress={() => {
            close();
            a.onPress(); // same window, so a follow-up confirm() can open immediately
          }}
          className="flex-row items-center rounded-2xl px-2 py-3.5 active:bg-ink-50"
        >
          <Icon name={a.icon} size={20} color={a.destructive ? '#DC2626' : '#334155'} />
          <Text className={`ml-3 text-base font-medium ${a.destructive ? 'text-alert-600' : 'text-ink-800'}`}>{a.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
}
