import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NOTICE_CATEGORIES } from '@/lib/constants';
import { humanize, timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Notice, SocietySummary } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { confirm, openSheet } from '@/components/ui/Overlays';
import { Button, Card, Chip, EmptyState, FeedSkeleton, Field, Icon, IconButton } from '@/components/ui';

const EMOJI: Record<string, string> = { GENERAL: '📢', MAINTENANCE: '🛠️', MEETING: '🗓️', EVENT: '🎉', WATER: '💧', ELECTRICITY: '⚡', SECURITY: '🛡️', PAYMENT: '💳' };

export default function Notices() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const society = useQuery({ queryKey: ['society', id], queryFn: () => api.get<SocietySummary>(`/societies/${id}`) });
  const q = useQuery({ queryKey: ['notices', id], queryFn: () => api.get<{ items: Notice[] }>(`/societies/${id}/notices`) });
  const isStaff = society.data?.membership?.role !== 'RESIDENT';
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', body: '', category: 'GENERAL', isPinned: false });
  const [busy, setBusy] = useState(false);

  const post = async () => {
    if (f.title.trim().length < 3 || f.body.trim().length < 5) return toast.error('Add a title and details');
    setBusy(true);
    try {
      await api.post(`/societies/${id}/notices`, { ...f, title: f.title.trim(), body: f.body.trim() });
      setOpen(false);
      setF({ title: '', body: '', category: 'GENERAL', isPinned: false });
      toast.success('Notice sent to all residents');
      q.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const manage = (n: Notice) =>
    openSheet([
      { label: n.isPinned ? 'Unpin' : 'Pin to top', icon: 'pin', onPress: async () => { await api.patch(`/societies/${id}/notices/${n.id}`, { isPinned: !n.isPinned }).catch(toast.error); q.refetch(); } },
      { label: 'Delete notice', icon: 'trash', destructive: true, onPress: async () => { if (await confirm('Delete notice?', undefined, { confirmText: 'Delete', destructive: true })) { await api.del(`/societies/${id}/notices/${n.id}`).catch(toast.error); q.refetch(); } } },
    ]);

  return (
    <View className="flex-1 bg-ink-50">
      <Header title="Notice board" subtitle={society.data?.name} right={isStaff ? <Button testID="new-notice" title="New" size="sm" icon="add" className="mr-2" onPress={() => setOpen(true)} /> : null} />
      {q.isLoading ? <FeedSkeleton /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
          {q.data?.items.length === 0 ? <EmptyState emoji="📭" title="No notices yet" body="RWA announcements will appear here." /> : null}
          {q.data?.items.map((n) => (
            <Card key={n.id} testID={`notice-${n.id}`} className={`mb-3 ${n.isPinned ? 'border-2 border-saffron-300' : ''}`}>
              <View className="flex-row items-start">
                <Text className="text-2xl">{EMOJI[n.category] ?? '📢'}</Text>
                <View className="ml-3 flex-1">
                  {n.isPinned ? <View className="mb-1 flex-row items-center"><Icon name="pin" size={12} color="#D96306" /><Text className="ml-1 text-xs font-bold uppercase text-saffron-600">Pinned</Text></View> : null}
                  <Text className="text-[17px] font-bold text-ink-900">{n.title}</Text>
                  <Text className="mt-1 text-[15px] leading-[22px] text-ink-700">{n.body}</Text>
                  <Text className="mt-2 text-xs text-ink-400">{humanize(n.category)} · {n.author.name} · {timeAgo(n.createdAt)}</Text>
                </View>
                {isStaff ? <IconButton label="Manage notice" name="ellipsis-vertical" color="#94A3B8" onPress={() => manage(n)} /> : null}
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-end bg-black/40">
          <View className="max-h-[90%] rounded-t-3xl bg-white p-5 pb-10">
            <View className="mb-3 flex-row items-center">
              <Text className="flex-1 text-xl font-extrabold text-ink-900">New notice</Text>
              <IconButton label="Close" name="close" onPress={() => setOpen(false)} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                {NOTICE_CATEGORIES.map((c) => <Chip key={c} label={`${EMOJI[c]} ${humanize(c)}`} selected={f.category === c} onPress={() => setF((x) => ({ ...x, category: c }))} />)}
              </ScrollView>
              <Field testID="notice-title" label="Title" value={f.title} onChangeText={(t) => setF((x) => ({ ...x, title: t }))} maxLength={120} />
              <Field testID="notice-body" label="Details" multiline value={f.body} onChangeText={(t) => setF((x) => ({ ...x, body: t }))} maxLength={5000} />
              <Pressable onPress={() => setF((x) => ({ ...x, isPinned: !x.isPinned }))} className="mb-4 flex-row items-center">
                <Text className="flex-1 font-semibold text-ink-800">📌 Pin to top</Text>
                <Switch value={f.isPinned} onValueChange={(v) => setF((x) => ({ ...x, isPinned: v }))} trackColor={{ true: '#0F766E' }} />
              </Pressable>
              <Button testID="publish-notice" title="Publish & notify residents" loading={busy} onPress={post} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
