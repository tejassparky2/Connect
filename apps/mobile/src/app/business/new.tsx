import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { normalizePhone } from '@/lib/format';
import { getFix, type Fix } from '@/lib/location';
import { toast } from '@/lib/toast';
import type { Business } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { ImagePickerRow } from '@/components/ImagePickerRow';
import { Header } from '@/components/ui/Header';
import { Button, Chip, EmptyState, Field, Icon } from '@/components/ui';

export default function NewBusiness() {
  const qc = useQueryClient();
  const me = useMe();
  const [f, setF] = useState({ name: '', description: '', phone: me.data?.phone?.replace('+91', '') ?? '', whatsapp: '', addressLine: '', pincode: me.data?.address?.pincode ?? '', gstin: '' });
  const [category, setCategory] = useState('CAFE');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  if (me.data?.verificationLevel === 'PHONE')
    return (
      <View className="flex-1 bg-white">
        <Header title="List your business" />
        <EmptyState emoji="📍" title="Verify your location first" body="Only location-verified residents can list businesses — it keeps the directory free of spam." action="Verify now" onAction={() => router.replace('/verify')} />
      </View>
    );

  const locate = async () => {
    setLocating(true);
    try {
      setFix(await getFix());
    } catch (e) {
      toast.error(e);
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    const phone = normalizePhone(f.phone);
    if (f.name.trim().length < 2) return toast.error('Enter the business name');
    if (!phone) return toast.error('Enter a valid business phone number');
    if (f.whatsapp && !normalizePhone(f.whatsapp)) return toast.error('Enter a valid WhatsApp number');
    if (f.addressLine.trim().length < 5) return toast.error('Enter the shop address');
    if (!/^[1-9]\d{5}$/.test(f.pincode)) return toast.error('Enter a valid PIN code');
    if (!fix) return toast.error('Pin the shop location (stand at the shop and tap "Use current location")');
    setBusy(true);
    try {
      const b = await api.post<Business>('/businesses', {
        name: f.name.trim(),
        category,
        description: f.description.trim() || undefined,
        phone,
        whatsapp: f.whatsapp ? normalizePhone(f.whatsapp) : undefined,
        addressLine: f.addressLine.trim(),
        pincode: f.pincode,
        lat: fix.lat,
        lng: fix.lng,
        photos,
        gstin: f.gstin.trim().toUpperCase() || undefined,
      });
      qc.invalidateQueries({ queryKey: ['businesses'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Your business is live! 🎉');
      router.replace(`/business/${b.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <Header title="List your business" subtitle="Free · Reach verified neighbours" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Field testID="biz-name" label="Business name" placeholder="e.g. Filter Kaapi House" value={f.name} onChangeText={set('name')} />
        <Text className="mb-2 text-sm font-semibold text-ink-700">Category</Text>
        <View className="mb-4 flex-row flex-wrap">
          {BUSINESS_CATEGORIES.map((c) => (
            <View key={c.key} className="mb-2">
              <Chip testID={`bizcat-${c.key}`} label={`${c.emoji} ${c.label}`} selected={category === c.key} onPress={() => setCategory(c.key)} />
            </View>
          ))}
        </View>
        <Field label="About" placeholder="What makes you special?" multiline value={f.description} onChangeText={set('description')} maxLength={1000} />
        <View className="flex-row">
          <Field testID="biz-phone" containerClassName="mr-3 flex-1" label="Phone" prefix="+91" keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} />
          <Field containerClassName="flex-1" label="WhatsApp" prefix="+91" keyboardType="phone-pad" placeholder="optional" value={f.whatsapp} onChangeText={set('whatsapp')} />
        </View>
        <Field testID="biz-address" label="Shop address" placeholder="14th Main, HSR Sector 3" value={f.addressLine} onChangeText={set('addressLine')} />
        <View className="flex-row">
          <Field testID="biz-pincode" containerClassName="mr-3 w-32" label="PIN code" keyboardType="number-pad" maxLength={6} value={f.pincode} onChangeText={set('pincode')} />
          <Field containerClassName="flex-1" label="GSTIN (for verified badge)" placeholder="optional" autoCapitalize="characters" value={f.gstin} onChangeText={set('gstin')} />
        </View>
        <View className={`mb-4 flex-row items-center rounded-2xl p-3 ${fix ? 'bg-brand-50' : 'bg-ink-50'}`}>
          <Icon name={fix ? 'checkmark-circle' : 'location-outline'} size={22} color="#0F766E" />
          <Text className="ml-2 flex-1 text-sm text-ink-700">{fix ? `Shop pinned (±${fix.accuracyM} m)` : 'Pin the shop on the map — stand at the shop'}</Text>
          <Button testID="biz-locate" title={fix ? 'Re-pin' : 'Use current location'} size="sm" variant="outline" loading={locating} onPress={locate} />
        </View>
        <Text className="mb-2 text-sm font-semibold text-ink-700">Photos</Text>
        <ImagePickerRow value={photos} onChange={setPhotos} max={8} onBusyChange={setUploading} />
        <Button testID="submit-business" title={uploading ? 'Uploading photos…' : 'Publish listing'} size="lg" loading={busy} disabled={uploading} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
