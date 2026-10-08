import React, { useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { humanize, timeAgo } from '@/lib/format';
import type { Ticket } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Button, Card, Chip, EmptyState, FeedSkeleton, Icon } from '@/components/ui';
import { CAT_EMOJI, STATUS_STYLE } from '@/components/ticketMeta';


export default function Tickets() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [status, setStatus] = useState<Ticket['status'] | undefined>();
  const [mine, setMine] = useState(false);
  const q = useQuery({ queryKey: ['tickets', id, status, mine], queryFn: () => api.get<{ items: Ticket[] }>(`/societies/${id}/tickets${qs({ status, mine: mine || undefined })}`) });
  return (
    <View className="flex-1 bg-ink-50">
      <Header title="Helpdesk" subtitle="Maintenance & complaints" right={<Button testID="new-ticket" title="Raise" size="sm" icon="add" className="mr-2" onPress={() => router.push(`/society/${id}/tickets/new`)} />} />
      <View className="bg-white py-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <Chip label="All" selected={!status && !mine} onPress={() => { setStatus(undefined); setMine(false); }} />
          <Chip label="Mine" selected={mine} onPress={() => setMine(!mine)} />
          {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).map((s) => <Chip key={s} label={humanize(s)} selected={status === s} onPress={() => setStatus(status === s ? undefined : s)} />)}
        </ScrollView>
      </View>
      {q.isLoading ? <FeedSkeleton /> : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState emoji="🧰" title="No complaints here" body="Lift not working? Water leakage? Raise it here and track it till it's fixed." action="Raise a complaint" onAction={() => router.push(`/society/${id}/tickets/new`)} />}
          renderItem={({ item }) => (
            <Card testID={`ticket-${item.id}`} className="mb-3" onPress={() => router.push(`/society/${id}/tickets/${item.id}`)}>
              <View className="flex-row items-start">
                <Text className="text-2xl">{CAT_EMOJI[item.category] ?? '📝'}</Text>
                <View className="ml-3 flex-1">
                  <Text className="text-base font-bold text-ink-900">{item.title}</Text>
                  <Text numberOfLines={2} className="mt-0.5 text-sm text-ink-600">{item.description}</Text>
                  <View className="mt-2 flex-row items-center">
                    <View style={{ backgroundColor: STATUS_STYLE[item.status].bg }} className="rounded-full px-2 py-0.5">
                      <Text style={{ color: STATUS_STYLE[item.status].fg }} className="text-xs font-bold">{humanize(item.status)}</Text>
                    </View>
                    {item.isPrivate ? <View className="ml-2"><Icon name="lock-closed" size={12} color="#64748B" /></View> : null}
                    <Text className="ml-2 text-xs text-ink-400">{item.author.name} · {timeAgo(item.createdAt)} · 💬 {item.commentCount ?? 0}</Text>
                  </View>
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}
