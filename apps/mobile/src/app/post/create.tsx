import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { POST_TYPES } from '@/lib/constants';
import { rupeesToPaise } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Post, PostType } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { ImagePickerRow } from '@/components/ImagePickerRow';
import { Button, Chip, EmptyState, Field, IconButton } from '@/components/ui';

const CONDITIONS = [
  { k: 'NEW', l: 'New' },
  { k: 'LIKE_NEW', l: 'Like new' },
  { k: 'GOOD', l: 'Good' },
  { k: 'FAIR', l: 'Fair' },
] as const;

export default function CreatePost() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useMe();
  const params = useLocalSearchParams<{ type?: PostType }>();
  const [type, setType] = useState<PostType>(params.type ?? 'GENERAL');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]['k']>('GOOD');
  const [severity, setSeverity] = useState<'INFO' | 'WARNING' | 'CRITICAL'>('WARNING');
  const [hobbyTag, setHobbyTag] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('18:00');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  if (me.data && me.data.verificationLevel === 'PHONE') {
    return (
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        <View className="px-2">
          <IconButton label="Close" name="close" onPress={() => router.back()} />
        </View>
        <EmptyState emoji="📍" title="Verify your location to post" body="To keep Mohalla Connect safe, only neighbours who've confirmed they live here can post. It takes 30 seconds at home." action="Verify now" onAction={() => router.replace('/verify')} />
      </View>
    );
  }

  const needsTitle = ['CLASSIFIED', 'LOST_FOUND', 'EVENT'].includes(type);
  const submit = async () => {
    const payload: Record<string, unknown> = { type, body: body.trim(), images };
    if (title.trim()) payload.title = title.trim();
    if (needsTitle && title.trim().length < 3) return toast.error('Add a short title');
    if (body.trim().length < 3) return toast.error('Write a few words about it');
    if (type === 'CLASSIFIED') {
      const p = price.trim() === '' || price.trim() === '0' ? 0 : rupeesToPaise(price);
      if (p == null) return toast.error('Enter a valid price in ₹');
      Object.assign(payload, { pricePaise: p, condition });
    }
    if (type === 'ALERT') Object.assign(payload, { severity });
    if (type === 'HOBBY') {
      if (hobbyTag.trim().length < 2) return toast.error('Which hobby? e.g. badminton');
      payload.hobbyTag = hobbyTag.trim().toLowerCase().replace(/^#/, '');
    }
    if (type === 'EVENT') {
      const at = new Date(`${eventDate}T${eventTime || '18:00'}:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || isNaN(at.getTime())) return toast.error('Enter the event date as YYYY-MM-DD');
      payload.eventAt = at.toISOString();
    }
    setLoading(true);
    try {
      const post = await api.post<Post & { underReview?: boolean }>('/posts', payload);
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['my-posts'] });
      toast.success(post.underReview ? 'Posted — it will appear after a quick review' : type === 'ALERT' && severity !== 'INFO' ? 'Alert sent to neighbours nearby 🚨' : 'Posted to your neighbourhood 🎉');
      router.back();
    } catch (e) {
      toast.error(e);
    } finally {
      setLoading(false);
    }
  };

  const hint = POST_TYPES.find((t) => t.key === type)?.hint;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center border-b border-ink-100 px-2 py-1">
        <IconButton testID="close-composer" label="Close" name="close" onPress={() => router.back()} />
        <Text className="ml-1 flex-1 text-lg font-bold text-ink-900">New post</Text>
        <Button testID="submit-post" title="Post" size="sm" loading={loading} onPress={submit} className="mr-2 px-5" />
      </View>
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
          {POST_TYPES.map((t) => (
            <Chip key={t.key} testID={`type-${t.key}`} label={`${t.emoji} ${t.label}`} selected={type === t.key} onPress={() => setType(t.key)} />
          ))}
        </ScrollView>
        <Text className="mb-4 text-sm text-ink-500">{hint}</Text>

        {type === 'ALERT' ? (
          <View className="mb-4">
            <Text className="mb-2 text-sm font-semibold text-ink-700">How urgent?</Text>
            <View className="flex-row">
              {(['INFO', 'WARNING', 'CRITICAL'] as const).map((s) => (
                <Pressable key={s} testID={`sev-${s}`} onPress={() => setSeverity(s)} className={`mr-2 flex-1 items-center rounded-2xl border-2 py-3 ${severity === s ? (s === 'CRITICAL' ? 'border-alert-600 bg-alert-50' : 'border-brand-700 bg-brand-50') : 'border-ink-200'}`}>
                  <Text className="text-xl">{s === 'INFO' ? 'ℹ️' : s === 'WARNING' ? '⚠️' : '🚨'}</Text>
                  <Text className="mt-1 text-xs font-bold text-ink-800">{s === 'INFO' ? 'FYI' : s === 'WARNING' ? 'Warning' : 'Emergency'}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="mt-2 text-xs text-ink-500">Warnings & emergencies notify everyone within 2 km. For life-threatening emergencies, call 112 first.</Text>
          </View>
        ) : null}

        {needsTitle || type === 'ALERT' || type === 'HOBBY' || type === 'RECOMMENDATION' ? (
          <Field testID="post-title" label={type === 'CLASSIFIED' ? 'What are you selling?' : 'Title'} placeholder={type === 'CLASSIFIED' ? 'e.g. Decathlon cycle' : type === 'ALERT' ? 'e.g. Chain snatching near bus stop' : 'Short headline'} value={title} onChangeText={setTitle} maxLength={120} />
        ) : null}

        {type === 'CLASSIFIED' ? (
          <>
            <Field testID="post-price" label="Price" prefix="₹" placeholder="0 for free" keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
            <Text className="mb-2 text-sm font-semibold text-ink-700">Condition</Text>
            <View className="mb-4 flex-row flex-wrap">
              {CONDITIONS.map((c) => (
                <Chip key={c.k} label={c.l} selected={condition === c.k} onPress={() => setCondition(c.k)} />
              ))}
            </View>
          </>
        ) : null}

        {type === 'HOBBY' ? <Field testID="post-hobby" label="Hobby" prefix="#" placeholder="badminton, chess, running…" value={hobbyTag} onChangeText={setHobbyTag} autoCapitalize="none" /> : null}

        {type === 'EVENT' ? (
          <View className="flex-row">
            <Field testID="post-event-date" containerClassName="mr-3 flex-1" label="Date" placeholder="YYYY-MM-DD" value={eventDate} onChangeText={setEventDate} maxLength={10} />
            <Field containerClassName="w-28" label="Time" placeholder="18:00" value={eventTime} onChangeText={setEventTime} maxLength={5} />
          </View>
        ) : null}

        <Field testID="post-body" label="Details" placeholder="What's happening in the mohalla?" multiline value={body} onChangeText={setBody} maxLength={3000} />
        <ImagePickerRow value={images} onChange={setImages} />
        <Text className="text-xs leading-4 text-ink-400">Visible to verified neighbours within ~5 km. Your exact address is never shown.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
