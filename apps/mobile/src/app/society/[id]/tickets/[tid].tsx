import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { humanize, timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Ticket } from '@/lib/types';
import { Composer } from '@/components/Composer';
import { Header } from '@/components/ui/Header';
import { Avatar, Button, Card, EmptyState } from '@/components/ui';
import { CAT_EMOJI, STATUS_STYLE } from '@/components/ticketMeta';

export default function TicketDetail() {
  const { id, tid } = useLocalSearchParams<{ id: string; tid: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', tid], queryFn: () => api.get<Ticket>(`/societies/${id}/tickets/${tid}`) });
  const t = q.data;

  const setStatus = async (status: Ticket['status']) => {
    try {
      await api.patch(`/societies/${id}/tickets/${tid}`, { status });
      toast.success(`Marked ${humanize(status).toLowerCase()}`);
      q.refetch();
      qc.invalidateQueries({ queryKey: ['tickets', id] });
      qc.invalidateQueries({ queryKey: ['society', id] });
    } catch (e) {
      toast.error(e);
    }
  };
  const comment = async (body: string) => {
    try {
      await api.post(`/societies/${id}/tickets/${tid}/comments`, { body });
      q.refetch();
      qc.invalidateQueries({ queryKey: ['tickets', id] });
    } catch (e) {
      toast.error(e);
      throw e;
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-50">
      <Header title="Complaint" />
      {q.isLoading ? <ActivityIndicator className="mt-10" color="#0F766E" /> : !t ? <EmptyState emoji="🫥" title="Not found" /> : (
        <>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
            <Card>
              <View className="flex-row items-center">
                <Text className="text-2xl">{CAT_EMOJI[t.category]}</Text>
                <View style={{ backgroundColor: STATUS_STYLE[t.status].bg }} className="ml-2 rounded-full px-2.5 py-1">
                  <Text testID="ticket-status" style={{ color: STATUS_STYLE[t.status].fg }} className="text-xs font-bold">{humanize(t.status)}</Text>
                </View>
                {t.isPrivate ? <Text className="ml-2 text-xs text-ink-500">🔒 Private</Text> : null}
              </View>
              <Text className="mt-3 text-xl font-extrabold text-ink-900">{t.title}</Text>
              <Text className="mt-2 text-[15px] leading-[22px] text-ink-700">{t.description}</Text>
              <Text className="mt-3 text-xs text-ink-400">Raised by {t.author.name} · {timeAgo(t.createdAt)}</Text>
              {t.canManage ? (
                <View className="mt-4 flex-row flex-wrap">
                  {t.status !== 'IN_PROGRESS' && t.status !== 'CLOSED' ? <Button testID="ticket-progress" title="Start work" size="sm" variant="secondary" className="mb-2 mr-2" onPress={() => setStatus('IN_PROGRESS')} /> : null}
                  {t.status !== 'RESOLVED' && t.status !== 'CLOSED' ? <Button testID="ticket-resolve" title="Mark resolved" size="sm" className="mb-2 mr-2" onPress={() => setStatus('RESOLVED')} /> : null}
                  {t.status !== 'CLOSED' ? <Button title="Close" size="sm" variant="outline" className="mb-2" onPress={() => setStatus('CLOSED')} /> : <Button title="Re-open" size="sm" variant="outline" onPress={() => setStatus('OPEN')} />}
                </View>
              ) : t.isMine ? (
                <View className="mt-4 flex-row">
                  {t.status !== 'CLOSED' ? <Button testID="ticket-close" title="Close complaint" size="sm" variant="outline" onPress={() => setStatus('CLOSED')} /> : <Button title="Re-open" size="sm" variant="outline" onPress={() => setStatus('OPEN')} />}
                </View>
              ) : null}
            </Card>
            <Text className="mb-2 mt-5 font-bold text-ink-900">Updates</Text>
            {t.comments?.length === 0 ? <Text className="text-sm text-ink-400">No updates yet.</Text> : null}
            {t.comments?.map((c) => (
              <View key={c.id} className="mb-3 flex-row">
                <Avatar name={c.author.name} size={32} />
                <View className="ml-2 flex-1 rounded-2xl rounded-tl-sm bg-white px-3 py-2">
                  <Text className="text-sm font-bold text-ink-900">{c.author.name} <Text className="text-xs font-normal text-ink-400">· {timeAgo(c.createdAt)}</Text></Text>
                  <Text className="mt-0.5 text-[15px] text-ink-700">{c.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Composer onSend={comment} placeholder="Add an update…" />
        </>
      )}
    </KeyboardAvoidingView>
  );
}
