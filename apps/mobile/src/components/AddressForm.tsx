import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getFix, guessPlace, type Fix } from '@/lib/location';
import { toast } from '@/lib/toast';
import type { Me } from '@/lib/types';
import { Button, Field, Icon } from '@/components/ui';

/** Sets the home pin (from on-device GPS) + flat details. Used in onboarding and "Move home". */
export function AddressForm({ step, onDone }: { step?: string; onDone?: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = qc.getQueryData<Me>(['me']);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ unit: '', building: '', street: '', locality: '', city: '', pincode: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const locate = async () => {
    setLocating(true);
    try {
      const pos = await getFix();
      setFix(pos);
      const g = await guessPlace(pos.lat, pos.lng);
      setF((s) => ({ ...s, street: s.street || g.street || '', locality: s.locality || g.locality || '', city: s.city || g.city || '', pincode: s.pincode || g.pincode || '' }));
    } catch (e) {
      toast.error(e);
    } finally {
      setLocating(false);
    }
  };

  const valid = fix && f.unit.trim() && f.locality.trim().length >= 2 && f.city.trim().length >= 2 && /^[1-9]\d{5}$/.test(f.pincode);

  const save = async () => {
    if (!fix || !valid) return;
    setSaving(true);
    try {
      const updated = await api.put<Me>('/me/address', {
        unit: f.unit.trim(),
        building: f.building.trim() || undefined,
        street: f.street.trim() || undefined,
        locality: f.locality.trim(),
        city: f.city.trim(),
        pincode: f.pincode,
        lat: fix.lat,
        lng: fix.lng,
      });
      qc.setQueryData(['me'], updated);
      qc.invalidateQueries();
      toast.success(updated.neighborhood ? `Welcome to ${updated.neighborhood.name}! 🎉` : 'Home address saved');
      if (onDone) onDone();
      else router.replace('/(tabs)');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
        {step ? <Text className="text-xs font-bold uppercase tracking-widest text-brand-700">{step}</Text> : null}
        <Text className="mt-2 text-3xl font-extrabold text-ink-900">Where's home{me?.name ? `, ${me.name.split(' ')[0]}` : ''}?</Text>
        <Text className="mb-6 mt-2 text-base leading-6 text-ink-500">Your exact location stays private. Neighbours only see your area, never your flat.</Text>

        <View className={`mb-6 rounded-3xl p-4 ${fix ? 'bg-brand-50' : 'bg-ink-50'}`}>
          <View className="flex-row items-center">
            <View className={`h-11 w-11 items-center justify-center rounded-2xl ${fix ? 'bg-brand-700' : 'bg-white'}`}>
              <Icon name={fix ? 'checkmark' : 'navigate'} size={20} color={fix ? '#fff' : '#0F766E'} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">{fix ? 'Home pin set' : 'Pin your home'}</Text>
              <Text className="text-xs text-ink-500">{fix ? `GPS accuracy ±${fix.accuracyM} m — stand at home for best results` : 'Do this while you are at home'}</Text>
            </View>
          </View>
          <Button testID="use-location" title={fix ? 'Update location' : 'Use my current location'} icon="locate" variant={fix ? 'outline' : 'primary'} className="mt-4" loading={locating} onPress={locate} />
        </View>

        <View className="flex-row">
          <Field testID="unit-input" containerClassName="mr-3 flex-1" label="Flat / House no." placeholder="B-1204" value={f.unit} onChangeText={set('unit')} />
          <Field testID="building-input" containerClassName="flex-1" label="Building / Tower" placeholder="Tower B" value={f.building} onChangeText={set('building')} />
        </View>
        <Field label="Street" placeholder="27th Main Road" value={f.street} onChangeText={set('street')} />
        <Field testID="locality-input" label="Locality" placeholder="HSR Layout Sector 2" value={f.locality} onChangeText={set('locality')} />
        <View className="flex-row">
          <Field testID="city-input" containerClassName="mr-3 flex-1" label="City" placeholder="Bengaluru" value={f.city} onChangeText={set('city')} />
          <Field testID="pincode-input" containerClassName="flex-1" label="PIN code" placeholder="560102" keyboardType="number-pad" maxLength={6} value={f.pincode} onChangeText={set('pincode')} />
        </View>
      </ScrollView>
      <View className="px-6 pt-2" style={{ paddingBottom: insets.bottom + 20 }}>
        <Button testID="save-address" title="Join my neighbourhood" size="lg" loading={saving} disabled={!valid} onPress={save} />
      </View>
    </KeyboardAvoidingView>
  );
}
