import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './index';

export function Header({ title, subtitle, right, back = true, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; back?: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 4 }} className="border-b border-ink-100 bg-white px-2 pb-2">
      <View className="h-12 flex-row items-center">
        {back ? (
          <IconButton testID="back" label="Go back" name="arrow-back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />
        ) : (
          <View className="w-2" />
        )}
        <View className="ml-1 flex-1">
          <Text numberOfLines={1} className="text-lg font-bold text-ink-900">
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="text-xs text-ink-500">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}
