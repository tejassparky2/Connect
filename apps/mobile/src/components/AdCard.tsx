import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { categoryMeta } from '@/lib/constants';
import { call, whatsapp } from '@/lib/contact';
import type { Ad } from '@/lib/types';
import { Icon, Img } from '@/components/ui';

const seen = new Set<string>();

/**
 * Record an impression — call only when the ad was actually VIEWED (≥60% visible for 1 s,
 * via FlatList viewability), never on mount: lists render rows far ahead of the viewport.
 * One per app session; the server also de-duplicates per user per day.
 */
export function recordAdImpression(adId: string) {
  if (seen.has(adId)) return;
  seen.add(adId);
  api.post(`/ads/${adId}/impression`).catch(() => undefined);
}

export function AdCard({ ad }: { ad: Ad }) {
  const act = () => {
    api.post(`/ads/${ad.id}/click`).catch(() => undefined);
    if (ad.cta === 'CALL') call(ad.business.phone);
    else if (ad.cta === 'WHATSAPP') whatsapp(ad.business.whatsapp ?? ad.business.phone, `Hi ${ad.business.name}! I saw your offer on Mohalla Connect.`);
    else router.push(`/business/${ad.business.id}`);
  };
  const cta = ad.cta === 'CALL' ? 'Call now' : ad.cta === 'WHATSAPP' ? 'WhatsApp' : 'View shop';
  const image = ad.imageUrl ?? ad.business.photos[0];

  return (
    <View testID={`ad-${ad.id}`} className="mb-3 overflow-hidden rounded-3xl border border-saffron-100 bg-white">
      {image ? <Img source={{ uri: image }} style={{ width: '100%', aspectRatio: 2.2 }} contentFit="cover" /> : null}
      <View className="p-4">
        <View className="mb-1 flex-row items-center">
          <Text className="text-xs font-bold uppercase tracking-wide text-saffron-600">Sponsored · Local</Text>
          <Text className="ml-2 text-xs text-ink-400">{categoryMeta(ad.business.category).emoji} {ad.business.name}</Text>
          {ad.business.isVerified ? <Icon name="checkmark-circle" size={13} color="#0F766E" /> : null}
        </View>
        <Text className="text-[17px] font-bold text-ink-900">{ad.headline}</Text>
        <Text className="mt-1 text-sm leading-5 text-ink-600">{ad.body}</Text>
        <Pressable testID={`ad-cta-${ad.id}`} onPress={act} className="mt-3 flex-row items-center justify-center rounded-2xl bg-saffron-500 py-2.5 active:bg-saffron-600">
          <Icon name={ad.cta === 'CALL' ? 'call' : ad.cta === 'WHATSAPP' ? 'logo-whatsapp' : 'storefront'} size={16} color="#fff" />
          <Text className="ml-2 font-semibold text-white">{cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}
