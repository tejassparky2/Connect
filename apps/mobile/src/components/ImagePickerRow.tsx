import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Icon, Img } from '@/components/ui';

/**
 * Pick → upload immediately → keep public URLs. Max `max` images.
 * `onChange` must be a state setter (functional updates avoid the stale-closure race where a
 * photo removed during an upload came back). `onBusyChange` lets the form block submit while
 * uploads are in flight.
 */
export function ImagePickerRow({
  value,
  onChange,
  max = 6,
  onBusyChange,
}: {
  value: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  max?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error('Photo permission is needed to add pictures');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: max - value.length });
    if (r.canceled) return;
    setBusy(true);
    try {
      for (const a of r.assets.slice(0, max - value.length)) {
        const url = await api.upload(a.uri, a.mimeType ?? 'image/jpeg');
        onChange((prev) => (prev.length < max ? [...prev, url] : prev));
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
      {value.map((u) => (
        <View key={u} className="mr-2">
          <Img source={{ uri: u }} style={{ width: 84, height: 84, borderRadius: 16 }} contentFit="cover" />
          <Pressable accessibilityLabel="Remove photo" hitSlop={8} onPress={() => onChange((prev) => prev.filter((x) => x !== u))} className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60">
            <Icon name="close" size={14} color="#fff" />
          </Pressable>
        </View>
      ))}
      {value.length < max ? (
        <Pressable testID="add-photo" accessibilityLabel="Add photos" onPress={busy ? undefined : pick} className="h-[84px] w-[84px] items-center justify-center rounded-2xl border-2 border-dashed border-ink-300 bg-ink-50">
          {busy ? <ActivityIndicator color="#0F766E" /> : <Icon name="camera-outline" size={26} color="#64748B" />}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
