import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View, type ViewToken } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { FEED_FILTERS } from '@/lib/constants';
import { formatDistance } from '@/lib/format';
import type { Ad, FeedPage, Post, PostType } from '@/lib/types';
import { useBadges, useMe } from '@/hooks/useMe';
import { AdCard, recordAdImpression } from '@/components/AdCard';
import { PostCard } from '@/components/PostCard';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Chip, EmptyState, FeedSkeleton, Icon, IconButton } from '@/components/ui';

type Row = { kind: 'post'; post: Post } | { kind: 'ad'; ad: Ad };

export default function Home() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const badges = useBadges();
  const [type, setType] = useState<PostType | undefined>(undefined);

  const stats = useQuery({
    queryKey: ['neighborhood'],
    queryFn: () => api.get<{ neighborhood: { name: string } | null; neighborsInRadius: number; postsThisWeek: number; radiusM: number }>('/me/neighborhood'),
  });

  const feed = useInfiniteQuery({
    queryKey: ['feed', type ?? 'ALL'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<FeedPage>(`/feed${qs({ type, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor,
  });

  const first = feed.data?.pages[0];
  const rows = useMemo<Row[]>(() => {
    const pinned = new Set(first?.pinnedAlerts.map((p) => p.id) ?? []);
    const seenIds = new Set<string>();
    const ad = first?.sponsored[0];
    const out: Row[] = [];
    feed.data?.pages.forEach((pg) =>
      pg.items.forEach((post) => {
        if (pinned.has(post.id) || seenIds.has(post.id)) return; // pinned alerts are shown on top
        seenIds.add(post.id);
        out.push({ kind: 'post', post });
        if (ad && out.length === 3) out.push({ kind: 'ad', ad }); // single sponsored slot
      }),
    );
    if (ad && out.length < 3) out.push({ kind: 'ad', ad });
    return out;
  }, [feed.data, first]);

  // Bill impressions only for ads that were actually seen.
  const viewability = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 1000 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
    viewableItems.forEach((v) => v.item?.kind === 'ad' && recordAdImpression(v.item.ad.id));
  }).current;

  const hoodName = stats.data?.neighborhood?.name ?? me.data?.address?.locality ?? 'Your neighbourhood';

  const header = (
    <View>
      {me.data ? <VerifyBanner level={me.data.verificationLevel} /> : null}

      {stats.data ? (
        <View className="mb-3 flex-row rounded-3xl bg-brand-700 p-4">
          <View className="flex-1">
            <Text className="text-2xl font-extrabold text-white">{stats.data.neighborsInRadius.toLocaleString('en-IN')}</Text>
            <Text className="text-xs text-brand-100">neighbours within {formatDistance(stats.data.radiusM)}</Text>
          </View>
          <View className="mx-3 w-px bg-white/20" />
          <View className="flex-1">
            <Text className="text-2xl font-extrabold text-white">{stats.data.postsThisWeek}</Text>
            <Text className="text-xs text-brand-100">posts this week</Text>
          </View>
          <Pressable onPress={() => router.push('/neighbors')} className="items-center justify-center">
            <Icon name="people" size={22} color="#fff" />
            <Text className="mt-0.5 text-[10px] font-semibold text-white">Meet</Text>
          </Pressable>
        </View>
      ) : null}

      {first?.pinnedAlerts.map((a) => (
        <Pressable key={a.id} testID={`pinned-${a.id}`} onPress={() => router.push(`/post/${a.id}`)} className={`mb-3 flex-row items-center rounded-3xl p-4 ${a.severity === 'CRITICAL' ? 'bg-alert-600' : 'bg-alert-50'}`}>
          <Text className="text-2xl">{a.severity === 'CRITICAL' ? '🚨' : '⚠️'}</Text>
          <View className="ml-3 flex-1">
            <Text className={`text-xs font-bold uppercase ${a.severity === 'CRITICAL' ? 'text-white/80' : 'text-alert-600'}`}>Active alert · {formatDistance(a.distanceM)}</Text>
            <Text numberOfLines={2} className={`font-bold ${a.severity === 'CRITICAL' ? 'text-white' : 'text-ink-900'}`}>
              {a.title ?? a.body}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={a.severity === 'CRITICAL' ? '#fff' : '#B91C1C'} />
        </Pressable>
      ))}

      {first?.expanded ? (
        <View className="mb-3 flex-row items-center rounded-2xl bg-ink-100 px-3 py-2.5">
          <Icon name="expand" size={16} color="#475569" />
          <Text className="ml-2 flex-1 text-xs text-ink-600">Your area is just getting started — showing posts within {formatDistance(first.radiusM)}. Invite neighbours to grow it!</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-ink-50">
      <View style={{ paddingTop: insets.top + 6 }} className="bg-white pb-2">
        <View className="flex-row items-center px-4">
          <View className="flex-1">
            <Text className="text-xs font-semibold text-ink-500">📍 Your mohalla</Text>
            <Text testID="hood-name" numberOfLines={1} className="text-xl font-extrabold text-ink-900">
              {hoodName}
            </Text>
          </View>
          <IconButton testID="open-messages" label="Messages" name="chatbubbles-outline" badge={badges.data?.messages} onPress={() => router.push('/messages')} />
          <IconButton testID="open-notifications" label="Notifications" name="notifications-outline" badge={badges.data?.notifications} onPress={() => router.push('/notifications')} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ paddingHorizontal: 16 }}>
          {FEED_FILTERS.map((f) => (
            <Chip key={f.label} testID={`filter-${f.key ?? 'ALL'}`} label={f.label} selected={type === f.key} onPress={() => setType(f.key)} />
          ))}
        </ScrollView>
      </View>

      {feed.isLoading ? (
        <FeedSkeleton />
      ) : feed.isError ? (
        <EmptyState emoji="📡" title="Couldn't load your feed" body={(feed.error as Error).message} action="Try again" onAction={() => feed.refetch()} />
      ) : (
        <FlatList
          testID="feed-list"
          data={rows}
          keyExtractor={(r) => (r.kind === 'post' ? r.post.id : `ad-${r.ad.id}`)}
          viewabilityConfig={viewability}
          onViewableItemsChanged={onViewable}
          renderItem={({ item }) => (item.kind === 'post' ? <PostCard post={item.post} /> : <AdCard ad={item.ad} />)}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              emoji={type === 'CLASSIFIED' ? '🏷️' : '🌱'}
              title={type ? 'Nothing here yet' : 'Be the first to post!'}
              body="Your neighbourhood feed is waiting. Say hello, ask for a recommendation or sell something you don't need."
              action="Create a post"
              onAction={() => router.push('/post/create')}
            />
          }
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => { feed.refetch(); stats.refetch(); badges.refetch(); }} tintColor="#0F766E" />}
          ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color="#0F766E" className="py-4" /> : null}
        />
      )}
    </View>
  );
}
