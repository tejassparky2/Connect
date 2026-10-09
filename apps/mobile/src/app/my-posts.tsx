import React from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Post } from '@/lib/types';
import { PostCard } from '@/components/PostCard';
import { Header } from '@/components/ui/Header';
import { EmptyState, FeedSkeleton, QueryError } from '@/components/ui';

export default function MyPosts() {
  const q = useQuery({ queryKey: ['my-posts'], queryFn: () => api.get<{ items: Post[] }>('/me/posts') });
  return (
    <View className="flex-1 bg-ink-50">
      <Header title="My posts & listings" />
      {q.isLoading ? <FeedSkeleton /> : q.isError ? <QueryError error={q.error} onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PostCard post={item} />}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState emoji="📝" title="You haven't posted yet" action="Create a post" onAction={() => router.push('/post/create')} />}
        />
      )}
    </View>
  );
}
