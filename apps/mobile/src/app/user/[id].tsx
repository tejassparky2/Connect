import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { Level } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { Header } from '@/components/ui/Header';
import { confirm } from '@/components/ui/Overlays';
import { Avatar, Button, Card, EmptyState, LevelBadge, QueryError } from '@/components/ui';

interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  verificationLevel: Level;
  neighborhood: string | null;
  bio: string | null;
  memberSince: string;
  postCount: number;
  isBlocked: boolean;
  vouchedByMe: boolean;
}

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => api.get<Profile>(`/users/${id}`) });
  const u = q.data;
  const isMe = me.data?.id === id;

  const vouch = async () => {
    if (!(await confirm(`Vouch for ${u?.name}?`, 'Only vouch if you personally know they live at their address. Your name is attached to this vouch.', { confirmText: 'I vouch' }))) return;
    try {
      const r = await api.post<{ vouches: number; required: number }>(`/users/${id}/vouch`);
      toast.success(`Vouch added (${r.vouches}/${r.required})`);
      q.refetch();
    } catch (e) {
      toast.error(e);
    }
  };
  const toggleBlock = async () => {
    if (!u) return;
    if (!u.isBlocked && !(await confirm(`Block ${u.name}?`, "You won't see each other's posts or messages.", { confirmText: 'Block', destructive: true }))) return;
    try {
      if (u.isBlocked) await api.del(`/users/${id}/block`);
      else await api.post(`/users/${id}/block`);
      toast.success(u.isBlocked ? 'Unblocked' : 'Blocked');
      q.refetch();
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <View className="flex-1 bg-ink-50">
      <Header title={u?.name ?? 'Neighbour'} />
      {q.isLoading ? (
        <ActivityIndicator className="mt-10" color="#0F766E" />
      ) : !u ? (
        q.isError && (q.error as { status?: number }).status !== 404 ? <QueryError error={q.error} onRetry={() => q.refetch()} /> : <EmptyState emoji="🫥" title="Profile not found" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
          <Card className="items-center py-6">
            <Avatar name={u.name} uri={u.avatarUrl} size={88} />
            <Text className="mt-3 text-2xl font-extrabold text-ink-900">{u.name}</Text>
            <Text className="mb-2 text-sm text-ink-500">{u.neighborhood ?? 'Neighbour'} · since {new Date(u.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</Text>
            <LevelBadge level={u.verificationLevel} />
            {u.bio ? <Text className="mt-4 text-center text-[15px] leading-5 text-ink-700">{u.bio}</Text> : null}
            <Text className="mt-3 text-xs text-ink-400">{u.postCount} posts</Text>
          </Card>
          {!isMe ? (
            <View className="mt-4">
              <Button testID="message-user" title="Send message" icon="chatbubble-ellipses" onPress={() => router.push({ pathname: '/messages/new', params: { userId: u.id, name: u.name } })} />
              {me.data?.verificationLevel === 'ADDRESS' && u.verificationLevel !== 'ADDRESS' ? (
                <Button testID="vouch-user" className="mt-3" variant="secondary" icon="shield-checkmark" title={u.vouchedByMe ? 'You vouched for them ✓' : 'Vouch they live nearby'} disabled={u.vouchedByMe} onPress={vouch} />
              ) : null}
              <Button className="mt-3" variant="ghost" icon="ban" title={u.isBlocked ? 'Unblock' : 'Block'} onPress={toggleBlock} />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
