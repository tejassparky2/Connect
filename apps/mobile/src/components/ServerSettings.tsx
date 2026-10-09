import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { create } from 'zustand';
import { getApiUrl, hasUsableServer, normalizeServerUrl, SERVER_SWITCH_ENABLED, setApiUrlOverride } from '@/lib/config';
import { toast } from '@/lib/toast';
import { BottomSheet } from '@/components/ui/Overlays';
import { Button, Field, Icon } from '@/components/ui';

/** Checks that `url` is a Mohalla Connect API: GET /health → { ok: true }. */
async function probe(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 75_000); // a sleeping free-tier server can take ~1 min to wake
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (res.ok && body?.ok) return null;
    return `The server answered, but it isn't a healthy Mohalla Connect API (HTTP ${res.status}).`;
  } catch {
    return "Couldn't reach that address. For a hosted server, check the URL. For a computer on your Wi-Fi, check the API is running and port 4000 is allowed through the firewall.";
  } finally {
    clearTimeout(timer);
  }
}

interface ServerSheetState {
  open: boolean;
  required: boolean;
  onSaved?: () => void;
  /** Bumped on save/reset so the inline link re-renders with the new address. */
  version: number;
}
const useServerSheet = create<ServerSheetState>(() => ({ open: false, required: false, version: 0 }));

/** Open the server sheet; `onSaved` runs after a server passes the health check (e.g. continue to sign-in). */
export const askForServer = (onSaved?: () => void) => useServerSheet.setState({ open: true, required: true, onSaved });
const openServerSheet = () => useServerSheet.setState({ open: true, required: false, onSaved: undefined });
const closeServerSheet = () => useServerSheet.setState({ open: false, onSaved: undefined });
const bump = () => useServerSheet.setState((s) => ({ version: s.version + 1 }));

/** Inline "Server: … · Change" link (welcome screen). Rendered only in test builds (see SERVER_SWITCH_ENABLED). */
export function ServerSettings() {
  useServerSheet((s) => s.version); // re-render after the address changes
  if (!SERVER_SWITCH_ENABLED) return null;
  const set = hasUsableServer();
  return (
    <Pressable testID="server-settings" accessibilityRole="button" onPress={openServerSheet} hitSlop={8} className="mt-2 flex-row items-center justify-center">
      <Icon name="server-outline" size={12} color="#94A3B8" />
      <Text numberOfLines={1} className="ml-1 text-xs text-ink-400">
        Server: {set ? getApiUrl().replace(/^https?:\/\//, '') : 'not set'} · <Text className="font-semibold text-brand-700">{set ? 'Change' : 'Set up'}</Text>
      </Text>
    </Pressable>
  );
}

/**
 * The server sheet itself. Mounted once at the app root (like the other overlay hosts) so it covers the
 * whole screen — BottomSheet fills its parent, so rendering it inside a small container clips it.
 */
export function ServerSheetHost() {
  const { open, required, onSaved } = useServerSheet();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(required || !hasUsableServer() ? '' : getApiUrl());
      setError(null);
    }
  }, [open, required]);
  if (!SERVER_SWITCH_ENABLED) return null;

  const save = async () => {
    const url = normalizeServerUrl(value);
    if (!url) return setError('Enter an address like mohalla-connect-api.onrender.com');
    setBusy(true);
    setError(null);
    const problem = await probe(url);
    setBusy(false);
    if (problem) return setError(problem);
    await setApiUrlOverride(url);
    bump();
    const next = onSaved;
    closeServerSheet();
    toast.success('Connected to server');
    next?.();
  };

  const reset = async () => {
    await setApiUrlOverride(null);
    bump();
    setValue('');
    setError(null);
  };

  return (
    <BottomSheet visible={open} onClose={closeServerSheet} testID="server-sheet">
      <Text className="text-xl font-extrabold text-ink-900">{required ? 'First, connect to your server' : 'Server address'}</Text>
      <Text className="mb-4 mt-1 text-sm leading-5 text-ink-500">
        Enter your Mohalla Connect server: a hosted address like mohalla-connect-api.onrender.com, or your computer's Wi-Fi IP and port (192.168.1.20:4000). A sleeping server can take a minute to answer.
      </Text>
      <Field testID="server-url" label="API address" placeholder="mohalla-connect-api.onrender.com" value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" error={error} />
      <View className="flex-row">
        <Button title="Reset" variant="secondary" className="mr-3" onPress={reset} />
        <Button testID="server-save" title={busy ? 'Connecting…' : 'Test & save'} className="flex-1" loading={busy} onPress={save} />
      </View>
    </BottomSheet>
  );
}
