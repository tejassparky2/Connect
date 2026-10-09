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
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (res.ok && body?.ok) return null;
    return `The server answered, but it isn't a healthy Mohalla Connect API (HTTP ${res.status}).`;
  } catch {
    return "Couldn't reach that address. Check the phone and computer are on the same Wi-Fi, the API is running, and port 4000 is allowed through the firewall.";
  } finally {
    clearTimeout(timer);
  }
}

const useServerSheet = create<{ open: boolean; required: boolean; onSaved?: () => void }>(() => ({ open: false, required: false }));

/** Open the server sheet; `onSaved` runs after a server passes the health check (e.g. continue to sign-in). */
export const askForServer = (onSaved?: () => void) => useServerSheet.setState({ open: true, required: true, onSaved });

/** "Server: … · Change" link + sheet. Rendered only in test builds (see SERVER_SWITCH_ENABLED). */
export function ServerSettings() {
  const { open, required, onSaved } = useServerSheet();
  const setOpen = (o: boolean) => useServerSheet.setState(o ? { open: true, required: false, onSaved: undefined } : { open: false, onSaved: undefined });
  const [current, setCurrent] = useState(getApiUrl());
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(required ? '' : getApiUrl());
      setError(null);
    }
  }, [open, required]);
  if (!SERVER_SWITCH_ENABLED) return null;

  const save = async () => {
    const url = normalizeServerUrl(value);
    if (!url) return setError('Enter an address like 192.168.1.20:4000');
    setBusy(true);
    setError(null);
    const problem = await probe(url);
    setBusy(false);
    if (problem) return setError(problem);
    await setApiUrlOverride(url);
    setCurrent(url);
    const next = onSaved;
    setOpen(false);
    toast.success('Connected to server');
    next?.();
  };

  return (
    <>
      <Pressable testID="server-settings" accessibilityRole="button" onPress={() => setOpen(true)} hitSlop={8} className="mt-2 flex-row items-center justify-center">
        <Icon name="server-outline" size={12} color="#94A3B8" />
        <Text numberOfLines={1} className="ml-1 text-xs text-ink-400">
          Server: {hasUsableServer() ? current.replace(/^https?:\/\//, '') : 'not set'} · <Text className="font-semibold text-brand-700">{hasUsableServer() ? 'Change' : 'Set up'}</Text>
        </Text>
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} testID="server-sheet">
        <Text className="text-xl font-extrabold text-ink-900">{required ? 'First, connect to your server' : 'Server address'}</Text>
        <Text className="mb-4 mt-1 text-sm leading-5 text-ink-500">
          This test build talks to your own Mohalla Connect API. Run it on your computer and enter the computer's Wi-Fi IP address and port.
        </Text>
        <Field testID="server-url" label="API address" placeholder="192.168.1.20:4000" value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" error={error} />
        <View className="flex-row">
          <Button title="Reset" variant="secondary" className="mr-3" onPress={async () => { await setApiUrlOverride(null); const d = getApiUrl(); setCurrent(d); setValue(d); setError(null); }} />
          <Button testID="server-save" title="Test & save" className="flex-1" loading={busy} onPress={save} />
        </View>
      </BottomSheet>
    </>
  );
}
