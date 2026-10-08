import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { categoryMeta } from '@/lib/constants';
import { call, whatsapp } from '@/lib/contact';
import { formatDistance, timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Announcement, Business, Review } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { Header } from '@/components/ui/Header';
import { openSheet } from '@/components/ui/Overlays';
import { Avatar, Button, Card, EmptyState, Field, Icon, IconButton, Img, Pill, SectionTitle, Stars } from '@/components/ui';

type Detail = Business & { announcements: Announcement[]; reviews: Review[]; myReview: Review | null };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export default function BusinessDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: ['business', id], queryFn: () => api.get<Detail>(`/businesses/${id}`) });
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const b = q.data;

  const submitReview = async () => {
    if (!rating) return toast.error('Tap the stars to rate');
    if (me.data?.verificationLevel === 'PHONE') return router.push('/verify');
    setSaving(true);
    try {
      await api.post(`/businesses/${id}/reviews`, { rating, body: text.trim() || undefined });
      toast.success('Thanks for your review!');
      setRating(0);
      setText('');
      await q.refetch();
      qc.invalidateQueries({ queryKey: ['businesses'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const report = () =>
    openSheet([
      {
        label: 'Report this business',
        icon: 'flag',
        destructive: true,
        onPress: async () => {
          try {
            await api.post('/reports', { targetType: 'BUSINESS', targetId: id, reason: 'SCAM' });
            toast.success('Reported. Thank you.');
          } catch (e) {
            toast.error(e);
          }
        },
      },
    ]);

  if (q.isLoading) return <View className="flex-1 bg-white"><Header title="" /><ActivityIndicator className="mt-10" color="#0F766E" /></View>;
  if (!b) return <View className="flex-1 bg-white"><Header title="Business" /><EmptyState emoji="🏚️" title="Business not found" /></View>;
  const cat = categoryMeta(b.category);
  const today = DAYS[(new Date().getDay() + 6) % 7];

  return (
    <View className="flex-1 bg-ink-50">
      <Header title={b.name} subtitle={`${cat.emoji} ${cat.label}`} right={b.isMine ? <Button testID="manage-business" title="Manage" size="sm" variant="secondary" onPress={() => router.push(`/business/${id}/manage`)} className="mr-2" /> : <IconButton label="More" name="ellipsis-horizontal" onPress={report} />} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {b.photos[0] ? <Img source={{ uri: b.photos[0] }} style={{ width: '100%', aspectRatio: 16 / 9 }} contentFit="cover" /> : <View className="h-36 items-center justify-center bg-saffron-50"><Text className="text-6xl">{cat.emoji}</Text></View>}
        <View className="px-4">
          <Card className="-mt-6">
            <View className="flex-row items-center">
              <Text className="mr-2 flex-shrink text-2xl font-extrabold text-ink-900">{b.name}</Text>
              {b.isVerified ? <Pill text="Verified" tone="brand" icon="checkmark-circle" /> : null}
            </View>
            <View className="mt-2 flex-row flex-wrap items-center">
              {b.ratingCount ? (
                <>
                  <Stars value={b.ratingAvg} />
                  <Text className="ml-1 text-sm font-bold text-ink-800">{b.ratingAvg.toFixed(1)}</Text>
                  <Text className="ml-1 text-sm text-ink-500">({b.ratingCount} reviews)</Text>
                </>
              ) : (
                <Text className="text-sm text-ink-500">New on Mohalla Connect</Text>
              )}
              {b.isNew ? <View className="ml-2"><Pill text="Newly opened" tone="saffron" /></View> : null}
            </View>
            {b.description ? <Text className="mt-3 text-[15px] leading-[22px] text-ink-700">{b.description}</Text> : null}
            <View className="mt-3 flex-row items-start">
              <Icon name="location" size={16} color="#64748B" />
              <Text className="ml-2 flex-1 text-sm text-ink-600">{b.addressLine} · {b.pincode}{b.distanceM != null ? ` · ${formatDistance(b.distanceM)} away` : ''}</Text>
            </View>
            {b.hours?.[today] ? (
              <View className="mt-2 flex-row items-center">
                <Icon name="time" size={16} color="#64748B" />
                <Text className="ml-2 text-sm text-ink-600">Today: {b.hours[today] === 'closed' ? 'Closed' : b.hours[today]}</Text>
              </View>
            ) : null}
            <View className="mt-4 flex-row">
              <Button testID="call-business" title="Call" icon="call" className="mr-2 flex-1" onPress={() => call(b.phone)} />
              {b.whatsapp ? <Button title="WhatsApp" icon="logo-whatsapp" variant="secondary" className="flex-1" onPress={() => whatsapp(b.whatsapp!, `Hi ${b.name}! I found you on Mohalla Connect.`)} /> : null}
            </View>
          </Card>

          {b.announcements.length ? (
            <>
              <SectionTitle title="Offers & updates" />
              {b.announcements.map((a) => (
                <View key={a.id} className="mb-2 rounded-3xl bg-saffron-50 p-4">
                  <Text className="text-base font-bold text-ink-900">🎉 {a.title}</Text>
                  <Text className="mt-1 text-sm text-ink-700">{a.body}</Text>
                  {a.validUntil ? <Text className="mt-1 text-xs text-saffron-700">Valid till {new Date(a.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text> : null}
                </View>
              ))}
            </>
          ) : null}

          <SectionTitle title="Reviews from neighbours" />
          {!b.isMine ? (
            <Card className="mb-3">
              <Text className="mb-2 font-semibold text-ink-800">{b.myReview ? 'Update your review' : 'Rate this place'}</Text>
              <Stars value={rating || b.myReview?.rating || 0} size={30} onChange={setRating} />
              <Field testID="review-text" containerClassName="mb-2 mt-3" placeholder="What did you like? (optional)" value={text} onChangeText={setText} multiline maxLength={1000} />
              <Button testID="submit-review" title="Post review" size="sm" loading={saving} disabled={!rating} onPress={submitReview} />
            </Card>
          ) : null}
          {b.reviews.length === 0 ? <Text className="py-4 text-center text-sm text-ink-400">No reviews yet</Text> : null}
          {b.reviews.map((r) => (
            <Card key={r.id} className="mb-2">
              <View className="flex-row items-center">
                <Avatar name={r.author.name} size={32} />
                <View className="ml-2 flex-1">
                  <Text className="text-sm font-bold text-ink-900">{r.author.name}{r.isMine ? ' (you)' : ''}</Text>
                  <Stars value={r.rating} size={12} />
                </View>
                <Text className="text-xs text-ink-400">{timeAgo(r.createdAt)}</Text>
              </View>
              {r.body ? <Text className="mt-2 text-sm leading-5 text-ink-700">{r.body}</Text> : null}
            </Card>
          ))}
          <Pressable onPress={() => router.push('/(tabs)/explore')} className="mt-4 items-center">
            <Text className="text-sm font-semibold text-brand-700">Explore more local places →</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
