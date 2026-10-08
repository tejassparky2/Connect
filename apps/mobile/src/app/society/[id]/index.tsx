import React from 'react';
import { Pressable, RefreshControl, ScrollView, Share, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { SocietySummary } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { confirm } from '@/components/ui/Overlays';
import { Button, Card, EmptyState, FeedSkeleton, Icon, Pill, SectionTitle, type IconName } from '@/components/ui';

export default function SocietyHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['society', id], queryFn: () => api.get<SocietySummary>(`/societies/${id}`) });
  const s = q.data;
  const isStaff = s?.membership?.status === 'APPROVED' && s.membership.role !== 'RESIDENT';
  const isAdmin = s?.membership?.role === 'RWA_ADMIN';

  const share = async () => {
    const msg = `Join ${s?.name} on Mohalla Connect 🏘️\nUse invite code: ${s?.inviteCode}\nDownload: https://mohallaconnect.in`;
    try {
      await Share.share({ message: msg });
    } catch {
      toast.info(`Invite code: ${s?.inviteCode}`);
    }
  };
  const rotate = async () => {
    if (!(await confirm('Generate a new invite code?', 'The old code will stop working immediately.', { confirmText: 'Rotate' }))) return;
    try {
      await api.post(`/societies/${id}/invite-code/rotate`);
      q.refetch();
      toast.success('New invite code generated');
    } catch (e) {
      toast.error(e);
    }
  };
  const setAutoApprove = async (v: boolean) => {
    try {
      await api.patch(`/societies/${id}`, { requireApproval: !v });
      q.refetch();
    } catch (e) {
      toast.error(e);
    }
  };
  const leave = async () => {
    if (!(await confirm(`Leave ${s?.name}?`, 'You will lose access to notices and the helpdesk.', { confirmText: 'Leave', destructive: true }))) return;
    try {
      await api.del(`/societies/${id}/membership`);
      qc.invalidateQueries({ queryKey: ['my-societies'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      router.back();
    } catch (e) {
      toast.error(e);
    }
  };

  if (q.isLoading) return <View className="flex-1"><Header title="Society" /><FeedSkeleton /></View>;
  if (!s) return <View className="flex-1"><Header title="Society" /><EmptyState emoji="🏚️" title="Society not found" /></View>;
  if (s.membership?.status !== 'APPROVED')
    return (
      <View className="flex-1 bg-white">
        <Header title={s.name} />
        <EmptyState emoji="🔒" title="Residents only" body={s.membership?.status === 'PENDING' ? 'Your join request is awaiting RWA approval.' : 'Join this society to see notices, the helpdesk and parking alerts.'} action={s.membership ? undefined : 'Request to join'} onAction={() => router.replace('/society/join')} />
      </View>
    );

  const tiles: { icon: IconName; label: string; sub: string; href: string; color: string; bg: string; testID: string }[] = [
    { icon: 'megaphone', label: 'Notice board', sub: 'Updates from the RWA', href: `/society/${id}/notices`, color: '#B45309', bg: '#FEF3C7', testID: 'tile-notices' },
    { icon: 'construct', label: 'Helpdesk', sub: `${s.stats?.openTickets ?? 0} open complaints`, href: `/society/${id}/tickets`, color: '#6D28D9', bg: '#EDE9FE', testID: 'tile-helpdesk' },
    { icon: 'car', label: 'Parking', sub: s.stats?.activeParking ? `${s.stats.activeParking} active alerts` : 'Alerts & my vehicles', href: `/society/${id}/parking`, color: '#B91C1C', bg: '#FEE2E2', testID: 'tile-parking' },
    { icon: 'people', label: 'Residents', sub: `${s.memberCount} verified members`, href: `/society/${id}/members`, color: '#0F766E', bg: '#D1FAEC', testID: 'tile-members' },
  ];

  return (
    <View className="flex-1 bg-ink-50">
      <Header title={s.name} subtitle={`${s.membership.tower ? `Tower ${s.membership.tower} · ` : ''}Flat ${s.membership.unit}`} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
        <Card className="bg-brand-700">
          <View className="flex-row items-center">
            <Text className="mr-2 flex-1 text-xl font-extrabold text-white">{s.name}</Text>
            {s.isVerified ? <Pill text="Verified RWA" tone="dark" icon="checkmark-circle" /> : <Pill text="Verification pending" tone="saffron" />}
          </View>
          <Text className="mt-1 text-sm text-brand-100">{s.addressLine}, {s.city}</Text>
          <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-200">Your role: {humanize(s.membership.role).replace('Rwa', 'RWA')}</Text>
        </Card>

        {isStaff && s.stats?.pendingRequests ? (
          <Pressable testID="pending-requests" onPress={() => router.push({ pathname: `/society/${id}/members`, params: { tab: 'PENDING' } })} className="mt-3 flex-row items-center rounded-3xl bg-alert-50 p-4">
            <Icon name="person-add" size={22} color="#DC2626" />
            <Text className="ml-3 flex-1 font-bold text-ink-900">{s.stats.pendingRequests} resident{s.stats.pendingRequests > 1 ? 's' : ''} waiting for approval</Text>
            <Icon name="chevron-forward" size={18} color="#DC2626" />
          </Pressable>
        ) : null}

        <View className="mt-3 flex-row flex-wrap justify-between">
          {tiles.map((t) => (
            <Pressable key={t.label} testID={t.testID} onPress={() => router.push(t.href)} className="mb-3 w-[48.5%] rounded-3xl bg-white p-4 active:opacity-90">
              <View style={{ backgroundColor: t.bg }} className="h-11 w-11 items-center justify-center rounded-2xl">
                <Icon name={t.icon} size={22} color={t.color} />
              </View>
              <Text className="mt-3 text-base font-bold text-ink-900">{t.label}</Text>
              <Text className="mt-0.5 text-xs text-ink-500">{t.sub}</Text>
            </Pressable>
          ))}
        </View>

        <Button testID="quick-parking" title="Someone's blocking my car" icon="car" variant="danger" onPress={() => router.push({ pathname: `/society/${id}/parking`, params: { report: '1' } })} />

        {isStaff ? (
          <>
            <SectionTitle title="Invite residents" />
            <Card>
              <Text className="text-xs font-semibold uppercase text-ink-500">Invite code</Text>
              <Text testID="invite-code-value" className="mt-1 text-3xl font-extrabold tracking-[6px] text-ink-900">{s.inviteCode}</Text>
              <View className="mt-3 flex-row">
                <Button title="Share on WhatsApp" icon="share-social" size="sm" className="mr-2 flex-1" onPress={share} />
                {isAdmin ? <Button title="New code" icon="refresh" size="sm" variant="outline" onPress={rotate} /> : null}
              </View>
              {isAdmin ? (
                <View className="mt-4 flex-row items-center border-t border-ink-100 pt-3">
                  <View className="flex-1">
                    <Text className="font-semibold text-ink-800">Auto-approve with code</Text>
                    <Text className="text-xs text-ink-500">Location-verified residents with the code join instantly</Text>
                  </View>
                  <Switch testID="auto-approve" value={!s.requireApproval} onValueChange={setAutoApprove} trackColor={{ true: '#0F766E' }} />
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        <Button title="Leave society" variant="ghost" className="mt-6" onPress={leave} />
      </ScrollView>
    </View>
  );
}
