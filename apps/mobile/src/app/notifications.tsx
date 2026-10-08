import React from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { AppNotification } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { EmptyState, FeedSkeleton, Icon, type IconName } from '@/components/ui';

const ICONS: Record<string, { icon: IconName; color: string; bg: string }> = {
  ALERT_NEARBY: { icon: 'warning', color: '#DC2626', bg: '#FEE2E2' },
  POST_COMMENT: { icon: 'chatbubble', color: '#0F766E', bg: '#D1FAEC' },
  POST_LIKE: { icon: 'heart', color: '#E11D48', bg: '#FFE4E6' },
  MESSAGE: { icon: 'chatbubbles', color: '#1D4ED8', bg: '#DBEAFE' },
  SOCIETY_NOTICE: { icon: 'megaphone', color: '#B45309', bg: '#FEF3C7' },
  SOCIETY_MEMBERSHIP: { icon: 'business', color: '#0F766E', bg: '#D1FAEC' },
  PARKING_ALERT: { icon: 'car', color: '#B91C1C', bg: '#FEE2E2' },
  TICKET_UPDATE: { icon: 'construct', color: '#6D28D9', bg: '#EDE9FE' },
  VOUCH_RECEIVED: { icon: 'shield-checkmark', color: '#0F766E', bg: '#D1FAEC' },
  REVIEW_RECEIVED: { icon: 'star', color: '#F5850B', bg: '#FFF8EB' },
  AD_STATUS: { icon: 'megaphone', color: '#D96306', bg: '#FFF8EB' },
  SYSTEM: { icon: 'information-circle', color: '#334155', bg: '#F1F5F9' },
};

export default function Notifications() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: AppNotification[]; nextCursor: string | null }>(`/notifications${qs({ cursor: pageParam })}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const open = async (n: AppNotification) => {
    if (!n.readAt) api.post(`/notifications/${n.id}/read`).then(() => { qc.invalidateQueries({ queryKey: ['badges'] }); q.refetch(); }).catch(() => undefined);
    const d = n.data ?? {};
    if (d.postId) router.push(`/post/${d.postId}`);
    else if (d.conversationId) router.push(`/messages/${d.conversationId}`);
    else if (d.ticketId && d.societyId) router.push(`/society/${d.societyId}/tickets/${d.ticketId}`);
    else if (d.alertId && d.societyId) router.push(`/society/${d.societyId}/parking`);
    else if (d.noticeId && d.societyId) router.push(`/society/${d.societyId}/notices`);
    else if (d.societyId) router.push(`/society/${d.societyId}`);
    else if (d.businessId) router.push(`/business/${d.businessId}`);
  };

  const readAll = async () => {
    await api.post('/notifications/read-all');
    qc.invalidateQueries({ queryKey: ['badges'] });
    q.refetch();
  };

  return (
    <View className="flex-1 bg-white">
      <Header title="Notifications" right={items.some((n) => !n.readAt) ? <Pressable testID="read-all" onPress={readAll} className="mr-3"><Text className="text-sm font-semibold text-brand-700">Mark all read</Text></Pressable> : null} />
      {q.isLoading ? (
        <FeedSkeleton />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          onEndReached={() => q.hasNextPage && q.fetchNextPage()}
          ListEmptyComponent={<EmptyState emoji="🔔" title="You're all caught up" body="Alerts, replies and society updates will show up here." />}
          renderItem={({ item }) => {
            const m = ICONS[item.type] ?? ICONS.SYSTEM;
            return (
              <Pressable testID={`notif-${item.id}`} onPress={() => open(item)} className={`flex-row px-4 py-3.5 active:bg-ink-50 ${item.readAt ? '' : 'bg-brand-50/50'}`}>
                <View style={{ backgroundColor: m.bg }} className="h-11 w-11 items-center justify-center rounded-2xl">
                  <Icon name={m.icon} size={20} color={m.color} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className={`text-[15px] ${item.readAt ? 'font-semibold text-ink-800' : 'font-bold text-ink-900'}`}>{item.title}</Text>
                  <Text numberOfLines={2} className="mt-0.5 text-sm text-ink-600">{item.body}</Text>
                  <Text className="mt-1 text-xs text-ink-400">{timeAgo(item.createdAt)}</Text>
                </View>
                {!item.readAt ? <View className="ml-2 mt-2 h-2.5 w-2.5 rounded-full bg-brand-600" /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
