import React from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Conversation } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Avatar, EmptyState, FeedSkeleton, QueryError } from '@/components/ui';

export default function Inbox() {
  const q = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<{ items: Conversation[] }>('/conversations'), refetchInterval: 15_000 });
  return (
    <View className="flex-1 bg-white">
      <Header title="Messages" />
      {q.isLoading ? (
        <FeedSkeleton />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState emoji="💬" title="No messages yet" body="Message a neighbour from any marketplace listing, lost & found or hobby post." />}
          renderItem={({ item }) => (
            <Pressable testID={`conv-${item.id}`} onPress={() => router.push(`/messages/${item.id}`)} className="flex-row items-center border-b border-ink-100 px-4 py-3.5 active:bg-ink-50">
              <Avatar name={item.other.name} uri={item.other.avatarUrl} size={48} />
              <View className="ml-3 flex-1">
                <View className="flex-row items-center">
                  <Text numberOfLines={1} className={`flex-1 text-base ${item.unread ? 'font-extrabold text-ink-900' : 'font-semibold text-ink-800'}`}>
                    {item.other.name}
                  </Text>
                  <Text className="text-xs text-ink-400">{timeAgo(item.lastMessageAt)}</Text>
                </View>
                <View className="flex-row items-center">
                  <Text numberOfLines={1} className={`flex-1 text-sm ${item.unread ? 'font-semibold text-ink-800' : 'text-ink-500'}`}>
                    {item.lastMessage}
                  </Text>
                  {item.unread ? <View className="ml-2 h-2.5 w-2.5 rounded-full bg-brand-600" /> : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
