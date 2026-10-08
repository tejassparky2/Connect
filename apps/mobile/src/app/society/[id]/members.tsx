import React, { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { humanize, timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Member, SocietySummary } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { confirm, openSheet } from '@/components/ui/Overlays';
import { Avatar, Button, EmptyState, FeedSkeleton, IconButton, LevelBadge, Pill, Segmented } from '@/components/ui';

export default function Members() {
  const { id, tab: initial } = useLocalSearchParams<{ id: string; tab?: 'PENDING' }>();
  const qc = useQueryClient();
  const society = useQuery({ queryKey: ['society', id], queryFn: () => api.get<SocietySummary>(`/societies/${id}`) });
  const role = society.data?.membership?.role;
  const isStaff = role === 'RWA_ADMIN' || role === 'RWA_COMMITTEE';
  const [tab, setTab] = useState<'APPROVED' | 'PENDING'>(initial === 'PENDING' ? 'PENDING' : 'APPROVED');
  const q = useQuery({ queryKey: ['members', id, tab], queryFn: () => api.get<{ items: Member[] }>(`/societies/${id}/members?status=${tab}`), enabled: tab === 'APPROVED' || isStaff });

  const refresh = () => {
    q.refetch();
    qc.invalidateQueries({ queryKey: ['society', id] });
    qc.invalidateQueries({ queryKey: ['my-societies'] });
  };
  const decide = async (m: Member, approve: boolean) => {
    try {
      await api.post(`/societies/${id}/members/${m.membershipId}/${approve ? 'approve' : 'reject'}`);
      toast.success(approve ? `${m.user.name} approved ✅` : 'Request declined');
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const manage = (m: Member) =>
    openSheet(
      [
        ...(['RESIDENT', 'RWA_COMMITTEE', 'RWA_ADMIN'] as const).filter((r) => r !== m.role).map((r) => ({
          label: `Make ${humanize(r).replace('Rwa', 'RWA')}`,
          icon: 'ribbon' as const,
          onPress: async () => { await api.patch(`/societies/${id}/members/${m.membershipId}`, { role: r }).catch(toast.error); refresh(); },
        })),
        { label: 'Remove from society', icon: 'person-remove', destructive: true, onPress: async () => { if (await confirm(`Remove ${m.user.name}?`, undefined, { confirmText: 'Remove', destructive: true })) { await api.patch(`/societies/${id}/members/${m.membershipId}`, { remove: true }).catch(toast.error); refresh(); } } },
      ],
      m.user.name,
    );

  return (
    <View className="flex-1 bg-white">
      <Header title="Residents" subtitle={society.data?.name} />
      {isStaff ? <View className="px-4 py-2"><Segmented options={[{ key: 'APPROVED', label: 'Directory' }, { key: 'PENDING', label: 'Join requests' }]} value={tab} onChange={setTab} /></View> : null}
      {q.isLoading ? <FeedSkeleton /> : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(m) => m.membershipId}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={refresh} />}
          ListEmptyComponent={<EmptyState emoji={tab === 'PENDING' ? '✅' : '👥'} title={tab === 'PENDING' ? 'No pending requests' : 'No residents yet'} />}
          renderItem={({ item: m }) => (
            <View testID={`member-${m.membershipId}`} className="flex-row items-center border-b border-ink-100 px-4 py-3">
              <Avatar name={m.user.name} size={44} />
              <View className="ml-3 flex-1">
                <View className="flex-row items-center">
                  <Text className="mr-1 text-base font-semibold text-ink-900">{m.user.name}</Text>
                  <LevelBadge level={m.user.verificationLevel} compact />
                </View>
                <Text className="text-xs text-ink-500">{m.tower ? `${m.tower}-` : ''}{m.unit} · {humanize(m.occupancy)}{tab === 'PENDING' ? ` · ${timeAgo(m.requestedAt)}` : ''}</Text>
                {m.role !== 'RESIDENT' ? <View className="mt-1"><Pill text={humanize(m.role).replace('Rwa', 'RWA')} tone="brand" /></View> : null}
              </View>
              {tab === 'PENDING' ? (
                <View className="flex-row">
                  <Button testID={`reject-${m.membershipId}`} title="Decline" size="sm" variant="outline" className="mr-2" onPress={() => decide(m, false)} />
                  <Button testID={`approve-${m.membershipId}`} title="Approve" size="sm" onPress={() => decide(m, true)} />
                </View>
              ) : role === 'RWA_ADMIN' && m.role !== 'RWA_ADMIN' ? (
                <IconButton label="Manage member" name="ellipsis-horizontal" color="#94A3B8" onPress={() => manage(m)} />
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}
