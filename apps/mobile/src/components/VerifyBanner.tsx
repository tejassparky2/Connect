import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Level } from '@/lib/types';
import { Icon } from '@/components/ui';

export function VerifyBanner({ level }: { level: Level }) {
  if (level !== 'PHONE') return null;
  return (
    <Pressable testID="verify-banner" onPress={() => router.push('/verify')} className="mb-3 flex-row items-center rounded-3xl bg-saffron-50 p-4 active:opacity-90">
      <View className="h-10 w-10 items-center justify-center rounded-2xl bg-saffron-500">
        <Icon name="shield-checkmark" size={20} color="#fff" />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-bold text-ink-900">Verify you live here</Text>
        <Text className="text-xs leading-4 text-ink-600">Takes 30 seconds at home. Unlocks posting, chat & your society.</Text>
      </View>
      <Icon name="chevron-forward" size={18} color="#B44309" />
    </Pressable>
  );
}
