import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { BUSINESS_CATEGORIES, categoryMeta, SKILLS } from '@/lib/constants';
import { formatDistance } from '@/lib/format';
import type { Announcement, Business, Provider } from '@/lib/types';
import { BusinessCard, ProviderCard } from '@/components/Cards';
import { Chip, EmptyState, FeedSkeleton, Icon, Segmented } from '@/components/ui';

type Tab = 'shops' | 'services';

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Explore() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('shops');
  const [category, setCategory] = useState<string | undefined>();
  const [skill, setSkill] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());

  const offers = useQuery({ queryKey: ['offers'], queryFn: () => api.get<{ items: Announcement[] }>('/businesses/offers/nearby'), enabled: tab === 'shops' });
  const shops = useInfiniteQuery({
    queryKey: ['businesses', category, q],
    enabled: tab === 'shops',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: Business[]; nextCursor: string | null }>(`/businesses${qs({ category, q, cursor: pageParam })}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const services = useInfiniteQuery({
    queryKey: ['providers', skill, q],
    enabled: tab === 'services',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: Provider[]; nextCursor: string | null }>(`/providers${qs({ skill, q, cursor: pageParam })}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const active = tab === 'shops' ? shops : services;
  const pages = (active.data?.pages ?? []) as { items: (Business | Provider)[] }[];
  const items = pages.flatMap((p) => p.items);

  const header = (
    <View>
      {tab === 'shops' && !category && !q && offers.data?.items.length ? (
        <View className="mb-2">
          <Text className="mb-2 text-base font-bold text-ink-900">🔥 Deals near you</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {offers.data.items.map((o) => (
              <Pressable key={o.id} onPress={() => router.push(`/business/${o.business?.id}`)} className="mr-3 w-64 rounded-3xl bg-saffron-500 p-4 active:opacity-90">
                <Text className="text-xs font-semibold text-white/80">{categoryMeta(o.business?.category ?? '').emoji} {o.business?.name} · {formatDistance(o.distanceM)}</Text>
                <Text numberOfLines={2} className="mt-1 text-base font-extrabold text-white">{o.title}</Text>
                <Text numberOfLines={2} className="mt-1 text-xs text-white/90">{o.body}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <Text className="mb-2 mt-2 text-base font-bold text-ink-900">{tab === 'shops' ? (category ? categoryMeta(category).label : 'Nearby shops & places') : 'Trusted help near you'}</Text>
    </View>
  );

  return (
    <View className="flex-1 bg-ink-50">
      <View style={{ paddingTop: insets.top + 6 }} className="bg-white px-4 pb-3">
        <View className="flex-row items-center">
          <Text className="flex-1 text-2xl font-extrabold text-ink-900">Local</Text>
          <Pressable testID="add-listing" onPress={() => router.push(tab === 'shops' ? '/business/new' : '/provider/new')} className="flex-row items-center rounded-full bg-brand-50 px-3 py-1.5">
            <Icon name="add" size={16} color="#0F766E" />
            <Text className="ml-1 text-sm font-semibold text-brand-800">{tab === 'shops' ? 'List business' : 'Add a worker'}</Text>
          </Pressable>
        </View>
        <View className="mt-3">
          <Segmented<Tab> options={[{ key: 'shops', label: '🏪 Shops & Cafés' }, { key: 'services', label: '🧰 Home services' }]} value={tab} onChange={setTab} />
        </View>
        <View className="mt-3 flex-row items-center rounded-2xl bg-ink-100 px-3">
          <Icon name="search" size={18} color="#64748B" />
          <TextInput testID="local-search" value={search} onChangeText={setSearch} placeholder={tab === 'shops' ? 'Search cafés, salons, kirana…' : 'Search by name…'} placeholderTextColor="#94A3B8" className="h-11 flex-1 px-2 text-base text-ink-900" />
          {search ? <Pressable onPress={() => setSearch('')}><Icon name="close-circle" size={18} color="#94A3B8" /></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
          <Chip label="All" selected={tab === 'shops' ? !category : !skill} onPress={() => (tab === 'shops' ? setCategory(undefined) : setSkill(undefined))} />
          {(tab === 'shops' ? BUSINESS_CATEGORIES : SKILLS).map((c) => (
            <Chip key={c.key} testID={`cat-${c.key}`} label={`${c.emoji} ${c.label}`} selected={(tab === 'shops' ? category : skill) === c.key} onPress={() => (tab === 'shops' ? setCategory(c.key) : setSkill(c.key))} />
          ))}
        </ScrollView>
      </View>
      {active.isLoading ? (
        <FeedSkeleton />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={active.isRefetching} onRefresh={() => { active.refetch(); offers.refetch(); }} />}
          onEndReached={() => active.hasNextPage && !active.isFetchingNextPage && active.fetchNextPage()}
          renderItem={({ item }) => (tab === 'shops' ? <BusinessCard b={item as Business} /> : <ProviderCard p={item as Provider} />)}
          ListEmptyComponent={
            <EmptyState
              emoji={tab === 'shops' ? '🏪' : '🧰'}
              title={tab === 'shops' ? 'No shops found' : 'No workers listed yet'}
              body={tab === 'shops' ? 'Own a local business? List it free and reach verified neighbours.' : 'Know a reliable maid, cook or plumber? Add them so neighbours can find them.'}
              action={tab === 'shops' ? 'List your business' : 'Add a worker'}
              onAction={() => router.push(tab === 'shops' ? '/business/new' : '/provider/new')}
            />
          }
        />
      )}
    </View>
  );
}
