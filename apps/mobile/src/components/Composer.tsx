import React, { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';

export function Composer({ onSend, placeholder = 'Message…', initial = '' }: { onSend: (text: string) => Promise<void>; placeholder?: string; initial?: string }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSend(t);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="flex-row items-end border-t border-ink-100 bg-white px-3 pt-2" style={{ paddingBottom: insets.bottom + 8 }}>
      <TextInput
        testID="message-input"
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        multiline
        maxLength={2000}
        className="max-h-28 min-h-[44px] flex-1 rounded-2xl bg-ink-100 px-4 py-3 text-base text-ink-900"
      />
      <Pressable testID="send-message" accessibilityLabel="Send" onPress={send} disabled={busy || !text.trim()} className={`ml-2 h-11 w-11 items-center justify-center rounded-full ${text.trim() ? 'bg-brand-700' : 'bg-ink-200'}`}>
        {busy ? <ActivityIndicator color="#fff" /> : <Icon name="send" size={18} color="#fff" />}
      </Pressable>
    </View>
  );
}
