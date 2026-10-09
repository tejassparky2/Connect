import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TICKET_CATEGORIES } from '@/lib/constants';
import { humanize } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Ticket } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Button, Chip, Field, Icon } from '@/components/ui';
import { CAT_EMOJI } from '@/components/ticketMeta';

export default function NewTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>('PLUMBING');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (title.trim().length < 5) return toast.error('Title should be at least 5 characters');
    if (description.trim().length < 10) return toast.error('Describe the issue in a bit more detail');
    setBusy(true);
    try {
      const t = await api.post<Ticket>(`/societies/${id}/tickets`, { title: title.trim(), description: description.trim(), category, isPrivate });
      qc.invalidateQueries({ queryKey: ['tickets', id] });
      qc.invalidateQueries({ queryKey: ['society', id] });
      toast.success('Complaint raised — the committee has been notified');
      router.replace(`/society/${id}/tickets/${t.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <Header title="Raise a complaint" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text className="mb-2 text-sm font-semibold text-ink-700">Category</Text>
        <View className="mb-4 flex-row flex-wrap">{TICKET_CATEGORIES.map((c) => <View key={c} className="mb-2"><Chip testID={`tcat-${c}`} label={`${CAT_EMOJI[c]} ${humanize(c)}`} selected={category === c} onPress={() => setCategory(c)} /></View>)}</View>
        <Field testID="ticket-title" label="Title" placeholder="e.g. Lift 2 in Tower A not working" value={title} onChangeText={setTitle} maxLength={120} />
        <Field testID="ticket-desc" label="Details" placeholder="When did it start? Which floor / flat?" multiline value={description} onChangeText={setDescription} maxLength={3000} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isPrivate }} onPress={() => setPrivate(!isPrivate)} className="mb-5 flex-row items-start rounded-2xl bg-ink-50 p-3">
          <Icon name={isPrivate ? 'checkbox' : 'square-outline'} size={22} color="#0F766E" />
          <View className="ml-2 flex-1">
            <Text className="font-semibold text-ink-800">Private complaint</Text>
            <Text className="text-xs text-ink-500">Only you and the RWA committee can see it (e.g. complaints about a neighbour).</Text>
          </View>
        </Pressable>
        <Button testID="submit-ticket" title="Submit complaint" size="lg" loading={busy} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
