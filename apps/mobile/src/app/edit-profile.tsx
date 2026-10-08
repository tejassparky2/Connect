import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { Me } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { Header } from '@/components/ui/Header';
import { Avatar, Button, Chip, Field, Icon } from '@/components/ui';

export default function EditProfile() {
  const qc = useQueryClient();
  const me = useMe();
  const [name, setName] = useState(me.data?.name ?? '');
  const [bio, setBio] = useState(me.data?.bio ?? '');
  const [avatarUrl, setAvatar] = useState(me.data?.avatarUrl ?? null);
  const [radius, setRadius] = useState(me.data?.feedRadiusM ?? 3000);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (r.canceled) return;
    try {
      setAvatar(await api.upload(r.assets[0].uri, r.assets[0].mimeType ?? 'image/jpeg'));
    } catch (e) {
      toast.error(e);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const u = await api.patch<Me>('/me', { name: name.trim(), bio: bio.trim(), avatarUrl, feedRadiusM: radius });
      qc.setQueryData(['me'], u);
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['neighborhood'] });
      toast.success('Profile updated');
      router.back();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <Header title="Edit profile" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={pick} className="mb-6 items-center">
          <Avatar name={name} uri={avatarUrl} size={96} />
          <View className="mt-2 flex-row items-center"><Icon name="camera" size={16} color="#0F766E" /><Text className="ml-1 font-semibold text-brand-700">Change photo</Text></View>
        </Pressable>
        <Field testID="edit-name" label="Name" value={name} onChangeText={setName} maxLength={60} />
        <Field label="Bio" placeholder="Tell neighbours a bit about yourself" multiline value={bio} onChangeText={setBio} maxLength={280} />
        <Text className="mb-2 text-sm font-semibold text-ink-700">Neighbourhood feed radius</Text>
        <View className="mb-1 flex-row">{[2000, 3000, 4000, 5000].map((r) => <Chip key={r} testID={`feedradius-${r}`} label={`${r / 1000} km`} selected={radius === r} onPress={() => setRadius(r)} />)}</View>
        <Text className="mb-6 text-xs text-ink-500">See posts, alerts and ads from neighbours within this distance of your home.</Text>
        <Button testID="save-profile" title="Save" size="lg" loading={busy} disabled={name.trim().length < 2} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
