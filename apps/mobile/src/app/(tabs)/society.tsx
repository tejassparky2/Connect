import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import type { SocietySummary } from '@/lib/types';
import { Button, Card, FeedSkeleton, Icon, Pill } from '@/components/ui';

interface Mine {
  membershipId: string;
  role: string;
  status: 'APPROVED' | 'PENDING';
  unit: string;
  tower: string | null;
  pendingRequests: number;
  society: SocietySummary;
}

export default function SocietyTab() {
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ['my-societies'], queryFn: () => api.get<{ items: Mine[] }>('/societies/mine') });
  const items = q.data?.items ?? [];

  return (
    <View className="flex-1 bg-ink-50">
      <View style={{ paddingTop: insets.top + 6 }} className="bg-white px-4 pb-3">
        <Text className="text-2xl font-extrabold text-ink-900">My Society</Text>
        <Text className="text-sm text-ink-500">Private to verified residents only</Text>
      </View>
      {q.isLoading ? (
        <FeedSkeleton />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
          {items.map((m) => (
            <Card key={m.membershipId} testID={`society-${m.society.id}`} className="mb-3" onPress={() => (m.status === 'APPROVED' ? router.push(`/society/${m.society.id}`) : undefined)}>
              <View className="flex-row items-center">
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-700">
                  <Icon name="business" size={26} color="#fff" />
                </View>
                <View className="ml-3 flex-1">
                  <View className="flex-row items-center">
                    <Text numberOfLines={1} className="mr-1 flex-shrink text-lg font-bold text-ink-900">{m.society.name}</Text>
                    {m.society.isVerified ? <Icon name="checkmark-circle" size={16} color="#0F766E" /> : null}
                  </View>
                  <Text className="text-xs text-ink-500">{m.tower ? `Tower ${m.tower} · ` : ''}Flat {m.unit} · {m.society.memberCount} members</Text>
                </View>
                {m.status === 'PENDING' ? <Pill text="Awaiting approval" tone="saffron" /> : <Icon name="chevron-forward" size={20} color="#94A3B8" />}
              </View>
              {m.status === 'APPROVED' && m.role !== 'RESIDENT' ? (
                <View className="mt-3 flex-row items-center rounded-2xl bg-brand-50 px-3 py-2">
                  <Icon name="ribbon" size={16} color="#0F766E" />
                  <Text className="ml-2 flex-1 text-sm font-semibold text-brand-800">{humanize(m.role).replace('Rwa', 'RWA')}</Text>
                  {m.pendingRequests ? <Pill text={`${m.pendingRequests} join request${m.pendingRequests > 1 ? 's' : ''}`} tone="danger" /> : null}
                </View>
              ) : null}
              {m.status === 'PENDING' ? <Text className="mt-3 text-xs leading-4 text-ink-500">Your RWA committee will verify your flat and approve you. You'll get a notification.</Text> : null}
            </Card>
          ))}

          {items.length === 0 ? (
            <Card className="items-center py-8">
              <Text className="text-5xl">🏢</Text>
              <Text className="mt-3 text-center text-xl font-extrabold text-ink-900">Join your housing society</Text>
              <Text className="mt-2 text-center text-sm leading-5 text-ink-500">Get RWA notices, raise maintenance complaints and send parking alerts — privately, only with verified residents of your building.</Text>
            </Card>
          ) : null}

          <View className="mt-4">
            <Button testID="find-society" title="Find & join my society" icon="search" onPress={() => router.push('/society/join')} />
            <Button testID="have-code" title="I have an invite code" icon="key" variant="outline" className="mt-3" onPress={() => router.push({ pathname: '/society/join', params: { code: '1' } })} />
            <Pressable testID="register-society" onPress={() => router.push('/society/new')} className="mt-5 items-center">
              <Text className="text-sm font-semibold text-brand-700">RWA member? Register your society →</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
