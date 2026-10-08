import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { Me } from '@/lib/types';
import { Button, Chip, Field } from '@/components/ui';

const LANGS = [
  { k: 'en', l: 'English' },
  { k: 'hi', l: 'हिन्दी' },
  { k: 'kn', l: 'ಕನ್ನಡ' },
  { k: 'ta', l: 'தமிழ்' },
  { k: 'te', l: 'తెలుగు' },
  { k: 'mr', l: 'मराठी' },
  { k: 'bn', l: 'বাংলা' },
];

export default function ProfileSetup() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (name.trim().length < 2) return toast.error('Please enter your name');
    setLoading(true);
    try {
      const me = await api.patch<Me>('/me', { name: name.trim(), language });
      qc.setQueryData(['me'], me);
    } catch (e) {
      toast.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white" style={{ paddingTop: insets.top + 24 }}>
      <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
        <Text className="text-xs font-bold uppercase tracking-widest text-brand-700">Step 1 of 2</Text>
        <Text className="mt-2 text-3xl font-extrabold text-ink-900">Hi neighbour 👋{'\n'}What should we call you?</Text>
        <Text className="mb-8 mt-2 text-base text-ink-500">Neighbours see your name — real names build trust.</Text>
        <Field testID="name-input" label="Full name" placeholder="e.g. Priya Sharma" value={name} onChangeText={setName} autoFocus autoCapitalize="words" maxLength={60} />
        <Text className="mb-2 text-sm font-semibold text-ink-700">Preferred language</Text>
        <View className="flex-row flex-wrap">
          {LANGS.map((l) => (
            <View key={l.k} className="mb-2">
              <Chip label={l.l} selected={language === l.k} onPress={() => setLanguage(l.k)} />
            </View>
          ))}
        </View>
      </ScrollView>
      <View className="px-6" style={{ paddingBottom: insets.bottom + 20 }}>
        <Button testID="save-name" title="Continue" size="lg" loading={loading} disabled={name.trim().length < 2} onPress={save} />
      </View>
    </KeyboardAvoidingView>
  );
}
