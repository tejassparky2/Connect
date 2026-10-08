import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { categoryMeta, skillLabel, SKILLS } from '@/lib/constants';
import { call } from '@/lib/contact';
import { formatDistance } from '@/lib/format';
import type { Business, Provider } from '@/lib/types';
import { Avatar, Card, Icon, Img, Pill, Stars } from '@/components/ui';

export function BusinessCard({ b }: { b: Business }) {
  const cat = categoryMeta(b.category);
  return (
    <Card testID={`biz-${b.id}`} className="mb-3 flex-row p-3" onPress={() => router.push(`/business/${b.id}`)}>
      {b.photos[0] ? (
        <Img source={{ uri: b.photos[0] }} style={{ width: 84, height: 84, borderRadius: 18 }} contentFit="cover" />
      ) : (
        <View className="h-[84px] w-[84px] items-center justify-center rounded-[18px] bg-saffron-50">
          <Text className="text-4xl">{cat.emoji}</Text>
        </View>
      )}
      <View className="ml-3 flex-1 justify-center">
        <View className="flex-row items-center">
          <Text numberOfLines={1} className="mr-1 flex-shrink text-base font-bold text-ink-900">{b.name}</Text>
          {b.isVerified ? <Icon name="checkmark-circle" size={15} color="#0F766E" /> : null}
        </View>
        <Text className="text-xs text-ink-500">{cat.emoji} {cat.label} · {formatDistance(b.distanceM)}</Text>
        <View className="mt-1.5 flex-row items-center">
          {b.ratingCount ? (
            <>
              <Stars value={b.ratingAvg} size={12} />
              <Text className="ml-1 text-xs font-semibold text-ink-700">{b.ratingAvg.toFixed(1)}</Text>
              <Text className="ml-1 text-xs text-ink-400">({b.ratingCount})</Text>
            </>
          ) : (
            <Text className="text-xs text-ink-400">No reviews yet</Text>
          )}
          {b.isNew ? <View className="ml-2"><Pill text="New" tone="saffron" /></View> : null}
        </View>
      </View>
      <Pressable accessibilityLabel={`Call ${b.name}`} onPress={() => call(b.phone)} className="h-10 w-10 items-center justify-center self-center rounded-full bg-brand-50">
        <Icon name="call" size={18} color="#0F766E" />
      </Pressable>
    </Card>
  );
}

export function ProviderCard({ p }: { p: Provider }) {
  const emoji = SKILLS.find((s) => s.key === p.skills[0])?.emoji ?? '🧰';
  return (
    <Card testID={`provider-${p.id}`} className="mb-3 p-3" onPress={() => router.push(`/provider/${p.id}`)}>
      <View className="flex-row items-center">
        <View>
          <Avatar name={p.name} size={52} />
          <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center rounded-full bg-white">
            <Text className="text-sm">{emoji}</Text>
          </View>
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text numberOfLines={1} className="mr-1 flex-shrink text-base font-bold text-ink-900">{p.name}</Text>
            {p.idVerified ? <Icon name="shield-checkmark" size={14} color="#0F766E" /> : null}
          </View>
          <Text numberOfLines={1} className="text-xs text-ink-500">{p.skills.map(skillLabel).join(' · ')}{p.experienceYrs ? ` · ${p.experienceYrs} yrs` : ''}</Text>
          <View className="mt-1 flex-row items-center">
            <Icon name="people" size={13} color="#0F766E" />
            <Text className="ml-1 text-xs font-semibold text-brand-800">{p.vouchCount} neighbour{p.vouchCount === 1 ? '' : 's'} vouch</Text>
            {p.ratingCount ? <Text className="ml-2 text-xs text-ink-500">★ {p.ratingAvg.toFixed(1)}</Text> : null}
          </View>
        </View>
        <View className="items-end">
          {p.rateNote ? <Text className="text-xs font-semibold text-ink-700">{p.rateNote}</Text> : null}
          <Pressable accessibilityLabel={`Call ${p.name}`} onPress={() => call(p.phone)} className="mt-1 h-9 w-9 items-center justify-center rounded-full bg-brand-700">
            <Icon name="call" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}
