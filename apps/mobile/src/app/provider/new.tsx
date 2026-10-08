import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SKILLS } from '@/lib/constants';
import { normalizePhone } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Provider } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { Header } from '@/components/ui/Header';
import { Button, Chip, EmptyState, Field, Icon } from '@/components/ui';

const LANGS = ['Hindi', 'Kannada', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'English', 'Urdu', 'Malayalam'];

export default function NewProvider() {
  const qc = useQueryClient();
  const me = useMe();
  const [f, setF] = useState({ name: '', phone: '', about: '', experienceYrs: '', rateNote: '' });
  const [skills, setSkills] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const toggle = (list: string[], v: string, setter: (x: string[]) => void, max: number) => setter(list.includes(v) ? list.filter((x) => x !== v) : list.length < max ? [...list, v] : list);

  if (me.data?.verificationLevel === 'PHONE')
    return (
      <View className="flex-1 bg-white">
        <Header title="Add a worker" />
        <EmptyState emoji="📍" title="Verify your location first" body="Only verified residents can recommend workers." action="Verify now" onAction={() => router.replace('/verify')} />
      </View>
    );

  const submit = async () => {
    const phone = normalizePhone(f.phone);
    if (f.name.trim().length < 2) return toast.error("Enter the worker's name");
    if (!phone) return toast.error('Enter a valid 10-digit mobile number');
    if (!skills.length) return toast.error('Pick at least one skill');
    if (!consent) return toast.error('Please confirm the worker agreed to be listed');
    setBusy(true);
    try {
      const p = await api.post<Provider>('/providers', {
        name: f.name.trim(),
        phone,
        skills,
        languages: langs,
        about: f.about.trim() || undefined,
        experienceYrs: f.experienceYrs ? Number(f.experienceYrs) : undefined,
        rateNote: f.rateNote.trim() || undefined,
        consent: true,
      });
      qc.invalidateQueries({ queryKey: ['providers'] });
      toast.success(`${p.name} added — thanks for helping neighbours!`);
      router.replace(`/provider/${p.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <Header title="Recommend a worker" subtitle="Maids, cooks, plumbers, drivers…" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Field testID="prov-name" label="Name" placeholder="e.g. Ramesh Kumar" value={f.name} onChangeText={set('name')} />
        <Field testID="prov-phone" label="Mobile number" prefix="+91" keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} />
        <Text className="mb-2 text-sm font-semibold text-ink-700">Skills (up to 5)</Text>
        <View className="mb-4 flex-row flex-wrap">
          {SKILLS.map((s) => (
            <View key={s.key} className="mb-2"><Chip testID={`skill-${s.key}`} label={`${s.emoji} ${s.label}`} selected={skills.includes(s.key)} onPress={() => toggle(skills, s.key, setSkills, 5)} /></View>
          ))}
        </View>
        <Text className="mb-2 text-sm font-semibold text-ink-700">Languages</Text>
        <View className="mb-4 flex-row flex-wrap">
          {LANGS.map((l) => (
            <View key={l} className="mb-2"><Chip label={l} selected={langs.includes(l)} onPress={() => toggle(langs, l, setLangs, 6)} /></View>
          ))}
        </View>
        <View className="flex-row">
          <Field containerClassName="mr-3 w-28" label="Experience" placeholder="yrs" keyboardType="number-pad" maxLength={2} value={f.experienceYrs} onChangeText={set('experienceYrs')} />
          <Field containerClassName="flex-1" label="Typical rate" placeholder="₹300/visit" value={f.rateNote} onChangeText={set('rateNote')} maxLength={60} />
        </View>
        <Field label="Why do you recommend them?" placeholder="Punctual, honest, works in our society for 3 years" multiline value={f.about} onChangeText={set('about')} maxLength={500} />
        <Pressable testID="prov-consent" onPress={() => setConsent(!consent)} className="mb-5 flex-row items-start rounded-2xl bg-ink-50 p-3">
          <Icon name={consent ? 'checkbox' : 'square-outline'} size={22} color="#0F766E" />
          <Text className="ml-2 flex-1 text-sm leading-5 text-ink-700">I have asked this worker and they agreed to have their name and number shared with neighbours.</Text>
        </Pressable>
        <Button testID="submit-provider" title="Add worker" size="lg" loading={busy} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
