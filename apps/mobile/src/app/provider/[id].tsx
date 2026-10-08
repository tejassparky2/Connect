import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { skillLabel, SKILLS } from '@/lib/constants';
import { call, whatsapp } from '@/lib/contact';
import { formatDistance, timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Provider, PublicUser, Review } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { Header } from '@/components/ui/Header';
import { Avatar, Button, Card, EmptyState, Field, Icon, Pill, SectionTitle, Stars } from '@/components/ui';

type Detail = Provider & { vouchedByMe: boolean; vouches: { note: string | null; createdAt: string; user: PublicUser }[]; reviews: Review[]; myReview: Review | null };

export default function ProviderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: ['provider', id], queryFn: () => api.get<Detail>(`/providers/${id}`) });
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const p = q.data;

  const vouch = async () => {
    if (me.data?.verificationLevel !== 'ADDRESS') return toast.info('Only address-verified residents can vouch. Join your society to get verified.');
    setBusy(true);
    try {
      if (p?.vouchedByMe) await api.del(`/providers/${id}/vouch`);
      else await api.post(`/providers/${id}/vouch`, { note: note.trim() || undefined });
      toast.success(p?.vouchedByMe ? 'Vouch removed' : 'Thanks for vouching! 🙏');
      setNote('');
      await q.refetch();
      qc.invalidateQueries({ queryKey: ['providers'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    if (!rating) return toast.error('Tap the stars to rate');
    setBusy(true);
    try {
      await api.post(`/providers/${id}/reviews`, { rating, body: text.trim() || undefined });
      toast.success('Review saved');
      setRating(0);
      setText('');
      q.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <View className="flex-1 bg-white"><Header title="" /><ActivityIndicator className="mt-10" color="#0F766E" /></View>;
  if (!p) return <View className="flex-1 bg-white"><Header title="Worker" /><EmptyState emoji="🫥" title="Not found" /></View>;

  return (
    <View className="flex-1 bg-ink-50">
      <Header title={p.name} subtitle={p.skills.map(skillLabel).join(' · ')} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card className="items-center py-6">
          <Avatar name={p.name} size={80} />
          <Text className="mt-3 text-2xl font-extrabold text-ink-900">{p.name}</Text>
          <View className="mt-2 flex-row flex-wrap justify-center">
            {p.skills.map((s) => (
              <View key={s} className="mx-1 mb-1">
                <Pill text={`${SKILLS.find((x) => x.key === s)?.emoji ?? ''} ${skillLabel(s)}`} tone="brand" />
              </View>
            ))}
          </View>
          <View className="mt-3 flex-row items-center">
            {p.idVerified ? <Pill text="ID / police verified" tone="brand" icon="shield-checkmark" /> : <Pill text="ID not verified yet" tone="neutral" />}
          </View>
          <View className="mt-4 w-full flex-row justify-around">
            <View className="items-center"><Text className="text-xl font-extrabold text-ink-900">{p.vouchCount}</Text><Text className="text-xs text-ink-500">vouches</Text></View>
            <View className="items-center"><Text className="text-xl font-extrabold text-ink-900">{p.ratingCount ? p.ratingAvg.toFixed(1) : '–'}</Text><Text className="text-xs text-ink-500">rating</Text></View>
            <View className="items-center"><Text className="text-xl font-extrabold text-ink-900">{p.experienceYrs ?? '–'}</Text><Text className="text-xs text-ink-500">years exp.</Text></View>
          </View>
          {p.about ? <Text className="mt-4 text-center text-[15px] leading-5 text-ink-700">{p.about}</Text> : null}
          <Text className="mt-3 text-xs text-ink-500">{[p.rateNote, p.languages.join(', '), p.distanceM != null ? `${formatDistance(p.distanceM)} away` : null].filter(Boolean).join(' · ')}</Text>
          <View className="mt-4 w-full flex-row">
            <Button testID="call-provider" title="Call" icon="call" className="mr-2 flex-1" onPress={() => call(p.phone)} />
            <Button title="WhatsApp" icon="logo-whatsapp" variant="secondary" className="flex-1" onPress={() => whatsapp(p.phone, `Namaste ${p.name}, I got your number from Mohalla Connect.`)} />
          </View>
        </Card>

        <SectionTitle title="Vouched by neighbours" />
        <Card className="mb-3">
          {!p.vouchedByMe ? <Field testID="vouch-note" containerClassName="mb-2" placeholder="e.g. Works at our home for 2 years, very honest" value={note} onChangeText={setNote} maxLength={200} /> : null}
          <Button testID="vouch-provider" title={p.vouchedByMe ? 'Remove my vouch' : 'I vouch for this worker'} variant={p.vouchedByMe ? 'outline' : 'primary'} icon="shield-checkmark" size="sm" loading={busy} onPress={vouch} />
        </Card>
        {p.vouches.map((v, i) => (
          <View key={i} className="mb-2 flex-row items-start rounded-2xl bg-white p-3">
            <Avatar name={v.user.name} size={30} />
            <View className="ml-2 flex-1">
              <Text className="text-sm font-semibold text-ink-900">{v.user.name} <Text className="text-xs font-normal text-ink-400">· {v.user.neighborhood ?? ''} · {timeAgo(v.createdAt)}</Text></Text>
              {v.note ? <Text className="text-sm text-ink-600">“{v.note}”</Text> : null}
            </View>
            <Icon name="shield-checkmark" size={14} color="#0F766E" />
          </View>
        ))}

        <SectionTitle title="Reviews" />
        <Card className="mb-3">
          <Stars value={rating || p.myReview?.rating || 0} size={28} onChange={setRating} />
          <Field containerClassName="mb-2 mt-3" placeholder="How was the work?" value={text} onChangeText={setText} multiline maxLength={1000} />
          <Button testID="submit-provider-review" title={p.myReview ? 'Update review' : 'Post review'} size="sm" disabled={!rating} loading={busy} onPress={review} />
        </Card>
        {p.reviews.map((r) => (
          <Card key={r.id} className="mb-2">
            <View className="flex-row items-center">
              <Text className="flex-1 text-sm font-bold text-ink-900">{r.author.name}</Text>
              <Stars value={r.rating} size={12} />
            </View>
            {r.body ? <Text className="mt-1 text-sm text-ink-700">{r.body}</Text> : null}
          </Card>
        ))}
        {p.canEdit ? <Button title="Back to Local" variant="ghost" className="mt-2" onPress={() => router.push('/(tabs)/explore')} /> : null}
      </ScrollView>
    </View>
  );
}
