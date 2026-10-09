import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, ApiError, qs } from '@/lib/api';
import { formatDistance } from '@/lib/format';
import type { Level } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Avatar, EmptyState, FeedSkeleton, Icon, LevelBadge, QueryError } from '@/components/ui';

interface N { id: string; name: string | null; avatarUrl: string | null; verificationLevel: Level; neighborhoodName: string | null; distanceM: number }

export default function Neighbors() {
  const q = useInfiniteQuery({
    queryKey: ['neighbors'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: N[]; nextCursor: string | null }>(`/me/neighbors${qs({ cursor: pageParam })}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const err = q.error as ApiError | null;
  return (
    <View className="flex-1 bg-white">
      <Header title="Neighbours near you" subtitle="Verified residents, nearest first" />
      {q.isLoading ? (
        <FeedSkeleton />
      ) : err?.code === 'VERIFICATION_REQUIRED' ? (
        <EmptyState emoji="📍" title="Verify to see neighbours" body="The neighbour directory is only visible to verified residents." action="Verify now" onAction={() => router.replace('/verify')} />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={q.data?.pages.flatMap((p) => p.items) ?? []}
          keyExtractor={(n) => n.id}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          ListEmptyComponent={<EmptyState emoji="🌱" title="No verified neighbours yet" body="Invite people on your street to join Mohalla Connect." />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/user/${item.id}`)} className="flex-row items-center border-b border-ink-100 px-4 py-3 active:bg-ink-50">
              <Avatar name={item.name} uri={item.avatarUrl} size={46} />
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-ink-900">{item.name ?? 'Neighbour'}</Text>
                <View className="mt-0.5 flex-row items-center">
                  <LevelBadge level={item.verificationLevel} compact />
                  <Text className="ml-1 text-xs text-ink-500">{item.neighborhoodName ?? ''} · ~{formatDistance(item.distanceM)}</Text>
                </View>
              </View>
              <Icon name="chevron-forward" size={18} color="#CBD5E1" />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
