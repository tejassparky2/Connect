import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { categoryMeta } from '@/lib/constants';
import { formatDistance, prettyPhone } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useMe } from '@/hooks/useMe';
import { confirm } from '@/components/ui/Overlays';
import { Avatar, Card, Icon, LevelBadge, Row, SectionTitle } from '@/components/ui';

export default function Profile() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useMe();
  const { refreshToken, signOut } = useAuth();
  const u = me.data;

  const logout = async () => {
    if (!(await confirm('Log out?', undefined, { confirmText: 'Log out' }))) return;
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    qc.clear();
    await signOut();
  };
  const deleteAccount = async () => {
    if (!(await confirm('Delete your account?', 'Your profile, address and memberships will be permanently erased (DPDP Act). This cannot be undone.', { confirmText: 'Delete forever', destructive: true }))) return;
    try {
      await api.del('/me');
      qc.clear();
      await signOut();
      toast.success('Your account has been deleted');
    } catch (e) {
      toast.error(e);
    }
  };

  const levelText = u?.verificationLevel === 'ADDRESS' ? 'Fully verified resident' : u?.verificationLevel === 'LOCATION' ? 'Location verified · get address-verified via your society' : 'Not verified yet — tap to verify';

  return (
    <ScrollView className="flex-1 bg-ink-50" contentContainerStyle={{ paddingTop: insets.top + 12, padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={me.isRefetching} onRefresh={() => me.refetch()} />}>
      <Card className="items-center py-6">
        <Pressable onPress={() => router.push('/edit-profile')}>
          <Avatar name={u?.name} uri={u?.avatarUrl} size={84} />
          <View className="absolute bottom-0 right-0 h-7 w-7 items-center justify-center rounded-full bg-brand-700"><Icon name="pencil" size={14} color="#fff" /></View>
        </Pressable>
        <Text testID="profile-name" className="mt-3 text-2xl font-extrabold text-ink-900">{u?.name}</Text>
        <Text className="text-sm text-ink-500">{u ? prettyPhone(u.phone) : ''}</Text>
        <View className="mt-2">{u ? <LevelBadge level={u.verificationLevel} /> : null}</View>
        {u?.bio ? <Text className="mt-3 text-center text-sm text-ink-600">{u.bio}</Text> : null}
      </Card>

      <Pressable testID="open-verify" onPress={() => router.push('/verify')} className={`mt-3 flex-row items-center rounded-3xl p-4 ${u?.verificationLevel === 'ADDRESS' ? 'bg-brand-50' : 'bg-saffron-50'}`}>
        <Icon name="shield-checkmark" size={22} color={u?.verificationLevel === 'ADDRESS' ? '#0F766E' : '#D96306'} />
        <Text className="ml-3 flex-1 text-sm font-semibold text-ink-800">{levelText}</Text>
        <Icon name="chevron-forward" size={18} color="#94A3B8" />
      </Pressable>

      <SectionTitle title="My home" />
      <Card className="py-1">
        <Row icon="home" label={u?.address ? `${u.address.unit}${u.address.building ? `, ${u.address.building}` : ''}` : 'No address'} value={u?.neighborhood?.name ?? u?.address?.locality} />
        <Row testID="radius-row" icon="radio" label="Feed radius" value={u ? formatDistance(u.feedRadiusM) : ''} onPress={() => router.push('/edit-profile')} />
        <Row icon="navigate" label="Moved house?" onPress={() => router.push('/move-home')} />
      </Card>

      <SectionTitle title="My activity" />
      <Card className="py-1">
        <Row testID="my-posts-row" icon="document-text" label="My posts & listings" onPress={() => router.push('/my-posts')} />
        <Row icon="chatbubbles" label="Messages" onPress={() => router.push('/messages')} />
        <Row icon="notifications" label="Notifications" onPress={() => router.push('/notifications')} />
        <Row icon="people" label="Neighbours near me" onPress={() => router.push('/neighbors')} />
      </Card>

      <SectionTitle title="My businesses" action="+ Add" onAction={() => router.push('/business/new')} />
      <Card className="py-1">
        {u?.businesses.length ? (
          u.businesses.map((b) => <Row key={b.id} testID={`my-biz-${b.id}`} icon="storefront" label={`${categoryMeta(b.category).emoji} ${b.name}`} value="Dashboard" onPress={() => router.push(`/business/${b.id}/manage`)} />)
        ) : (
          <Row icon="storefront-outline" label="List your shop or service — free" onPress={() => router.push('/business/new')} />
        )}
      </Card>

      <SectionTitle title="Account" />
      <Card className="py-1">
        <Row icon="create" label="Edit profile" onPress={() => router.push('/edit-profile')} />
        <Row testID="logout" icon="log-out" label="Log out" onPress={logout} />
        <Row icon="trash" label="Delete account" danger onPress={deleteAccount} />
      </Card>
      <Text className="mt-6 text-center text-xs text-ink-400">Mohalla Connect v1.0 · Made with ❤️ for India's neighbourhoods</Text>
    </ScrollView>
  );
}
