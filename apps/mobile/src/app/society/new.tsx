import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getFix, type Fix } from '@/lib/location';
import { toast } from '@/lib/toast';
import { useMe } from '@/hooks/useMe';
import { Header } from '@/components/ui/Header';
import { Button, Chip, EmptyState, Field, Icon } from '@/components/ui';

const TYPES = [
  { k: 'APARTMENT', l: '🏢 Apartment' },
  { k: 'GATED_COMMUNITY', l: '🏘️ Gated community' },
  { k: 'STANDALONE_BUILDING', l: '🏠 Building' },
  { k: 'COLONY', l: '🌳 Colony / RWA' },
] as const;

export default function NewSociety() {
  const qc = useQueryClient();
  const me = useMe();
  const [f, setF] = useState({ name: '', addressLine: [me.data?.address?.street, me.data?.address?.locality].filter(Boolean).join(', '), city: me.data?.address?.city ?? '', pincode: me.data?.address?.pincode ?? '', tower: '', unit: me.data?.address?.unit ?? '' });
  const [type, setType] = useState<(typeof TYPES)[number]['k']>('APARTMENT');
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  if (me.data?.verificationLevel === 'PHONE')
    return (
      <View className="flex-1 bg-white">
        <Header title="Register society" />
        <EmptyState emoji="📍" title="Verify your location first" body="You need to confirm you live here before registering your society." action="Verify now" onAction={() => router.replace('/verify')} />
      </View>
    );

  const submit = async () => {
    if (!fix) return toast.error('Pin the society gate location');
    if (f.name.trim().length < 3) return toast.error('Enter the society name');
    setBusy(true);
    try {
      const s = await api.post<{ id: string }>('/societies', { name: f.name.trim(), type, addressLine: f.addressLine.trim(), city: f.city.trim(), pincode: f.pincode, lat: fix.lat, lng: fix.lng, tower: f.tower.trim() || undefined, unit: f.unit.trim() });
      qc.invalidateQueries({ queryKey: ['my-societies'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success("Society registered! You're the RWA admin 🎉");
      router.replace(`/society/${s.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <Header title="Register your society" subtitle="You'll become the RWA admin" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Field testID="soc-name" label="Society name" placeholder="Green Meadows Residency" value={f.name} onChangeText={set('name')} />
        <View className="mb-4 flex-row flex-wrap">{TYPES.map((t) => <View key={t.k} className="mb-2"><Chip label={t.l} selected={type === t.k} onPress={() => setType(t.k)} /></View>)}</View>
        <Field testID="soc-address" label="Address" value={f.addressLine} onChangeText={set('addressLine')} />
        <View className="flex-row">
          <Field testID="soc-city" containerClassName="mr-3 flex-1" label="City" value={f.city} onChangeText={set('city')} />
          <Field testID="soc-pincode" containerClassName="w-32" label="PIN" keyboardType="number-pad" maxLength={6} value={f.pincode} onChangeText={set('pincode')} />
        </View>
        <View className="flex-row">
          <Field containerClassName="mr-3 w-28" label="Your tower" value={f.tower} onChangeText={set('tower')} />
          <Field testID="soc-unit" containerClassName="flex-1" label="Your flat" value={f.unit} onChangeText={set('unit')} />
        </View>
        <View className={`mb-5 flex-row items-center rounded-2xl p-3 ${fix ? 'bg-brand-50' : 'bg-ink-50'}`}>
          <Icon name={fix ? 'checkmark-circle' : 'location-outline'} size={22} color="#0F766E" />
          <Text className="ml-2 flex-1 text-sm text-ink-700">{fix ? 'Society location pinned' : 'Pin the society (you must be inside the compound)'}</Text>
          <Button testID="soc-locate" title={fix ? 'Re-pin' : 'Use location'} size="sm" variant="outline" loading={locating} onPress={async () => { setLocating(true); try { setFix(await getFix()); } catch (e) { toast.error(e); } finally { setLocating(false); } }} />
        </View>
        <Button testID="submit-society" title="Register society" size="lg" loading={busy} onPress={submit} />
        <Text className="mt-3 text-center text-xs leading-4 text-ink-400">Our team verifies the RWA registration to give your society a ✓ badge. Members approved by a verified RWA get full address verification.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
