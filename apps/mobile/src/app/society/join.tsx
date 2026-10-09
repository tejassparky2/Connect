import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { BottomSheet } from '@/components/ui/Overlays';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDistance } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { SocietySummary } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Button, Card, Chip, EmptyState, Field, Icon } from '@/components/ui';

export default function JoinSociety() {
  const params = useLocalSearchParams<{ code?: string }>();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [code, setCode] = useState('');
  const [target, setTarget] = useState<{ societyId?: string; inviteCode?: string; name: string } | null>(null);
  const [tower, setTower] = useState('');
  const [unit, setUnit] = useState('');
  const [occupancy, setOccupancy] = useState<'OWNER' | 'TENANT' | 'FAMILY_MEMBER'>('OWNER');
  const [busy, setBusy] = useState(false);
  const nearby = useQuery({ queryKey: ['societies-nearby', search], queryFn: () => api.get<{ items: SocietySummary[] }>(`/societies/nearby?q=${encodeURIComponent(search)}`) });

  const join = async () => {
    if (!target || !unit.trim()) return toast.error('Enter your flat number');
    setBusy(true);
    try {
      const r = await api.post<{ status: string; society: { id: string; name: string } }>('/societies/join', { ...(target.societyId ? { societyId: target.societyId } : { inviteCode: target.inviteCode }), tower: tower.trim() || undefined, unit: unit.trim(), occupancy });
      qc.invalidateQueries({ queryKey: ['my-societies'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['verification'] });
      setTarget(null);
      if (r.status === 'APPROVED') {
        toast.success(`Welcome to ${r.society.name}! 🏠`);
        router.replace(`/society/${r.society.id}`);
      } else {
        toast.success('Request sent to your RWA for approval');
        router.back();
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-50">
      <Header title="Join your society" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card className="mb-4">
          <Text className="mb-1 text-base font-bold text-ink-900">🔑 Have an invite code?</Text>
          <Text className="mb-3 text-xs text-ink-500">Your RWA shares an 8-character code on the society WhatsApp group or notice board.</Text>
          <View className="flex-row items-start">
            <Field testID="invite-code" containerClassName="mr-2 flex-1 mb-0" placeholder="e.g. GREEN234" autoCapitalize="characters" maxLength={8} value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoFocus={!!params.code} />
            <Button testID="use-code" title="Next" disabled={code.length !== 8} onPress={() => setTarget({ inviteCode: code, name: 'your society' })} />
          </View>
        </Card>

        <Text className="mb-2 text-base font-bold text-ink-900">Societies near your home</Text>
        <Field testID="society-search" placeholder="Search by name…" value={search} onChangeText={setSearch} />
        {nearby.data?.items.length === 0 ? <EmptyState emoji="🏗️" title="No societies registered nearby" body="Be the first! Register your society and invite your neighbours." action="Register my society" onAction={() => router.replace('/society/new')} /> : null}
        {nearby.data?.items.map((s) => (
          <Card key={s.id} testID={`nearby-society-${s.id}`} className="mb-2" onPress={() => setTarget({ societyId: s.id, name: s.name })}>
            <View className="flex-row items-center">
              <Icon name="business" size={22} color="#0F766E" />
              <View className="ml-3 flex-1">
                <View className="flex-row items-center">
                  <Text numberOfLines={1} className="mr-1 flex-shrink text-base font-bold text-ink-900">{s.name}</Text>
                  {s.isVerified ? <Icon name="checkmark-circle" size={14} color="#0F766E" /> : null}
                </View>
                <Text className="text-xs text-ink-500">{s.addressLine} · {formatDistance(s.distanceM)} · {s.memberCount} members</Text>
              </View>
              <Text className="font-semibold text-brand-700">Join</Text>
            </View>
          </Card>
        ))}
      </ScrollView>

      <BottomSheet visible={!!target} onClose={() => setTarget(null)}>
            <Text className="text-xl font-extrabold text-ink-900">Join {target?.name}</Text>
            <Text className="mb-4 mt-1 text-sm text-ink-500">Your RWA uses this to verify you're a resident.</Text>
            <View className="flex-row">
              <Field testID="join-tower" containerClassName="mr-3 w-28" label="Tower / Block" placeholder="B" value={tower} onChangeText={setTower} maxLength={20} />
              <Field testID="join-unit" containerClassName="flex-1" label="Flat no." placeholder="1204" value={unit} onChangeText={setUnit} maxLength={20} />
            </View>
            <Text className="mb-2 text-sm font-semibold text-ink-700">I am a</Text>
            <View className="mb-5 flex-row">
              {(['OWNER', 'TENANT', 'FAMILY_MEMBER'] as const).map((o) => (
                <Chip key={o} label={o === 'FAMILY_MEMBER' ? 'Family member' : o === 'OWNER' ? 'Owner' : 'Tenant'} selected={occupancy === o} onPress={() => setOccupancy(o)} />
              ))}
            </View>
            <Button testID="submit-join" title="Request to join" size="lg" loading={busy} disabled={!unit.trim()} onPress={join} />
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}
