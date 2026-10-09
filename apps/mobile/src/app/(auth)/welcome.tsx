import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, type IconName } from '@/components/ui';

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'people', title: 'Your verified neighbours', body: 'A private feed for people who actually live within 2–5 km of you.' },
  { icon: 'storefront', title: 'Trusted local services', body: 'Cafés, kirana, salons — and maids, plumbers & drivers vouched for by residents.' },
  { icon: 'business', title: 'Your society, organised', body: 'RWA notices, maintenance complaints and parking alerts in one place.' },
];

export default function Welcome() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-white">
      <StatusBar style="light" />
      <LinearGradient colors={['#0F766E', '#115E59']} style={{ paddingTop: insets.top + 32, paddingBottom: 48, paddingHorizontal: 24, borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}>
        <View className="mb-6 h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
          <Text className="text-3xl">🏘️</Text>
        </View>
        <Text className="text-4xl font-extrabold leading-tight text-white">Mohalla{'\n'}Connect</Text>
        <Text className="mt-3 text-base leading-6 text-brand-100">Apna mohalla, ab ek app mein. The trusted network for your neighbourhood and housing society.</Text>
      </LinearGradient>
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingTop: 28, paddingBottom: 24 }}>
        {PILLARS.map((p) => (
          <View key={p.title} className="mb-5 flex-row">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
              <Icon name={p.icon} size={22} color="#0F766E" />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-base font-bold text-ink-900">{p.title}</Text>
              <Text className="mt-0.5 text-sm leading-5 text-ink-500">{p.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View className="px-6" style={{ paddingBottom: insets.bottom + 20 }}>
        <Button testID="get-started" title="Get started" size="lg" onPress={() => router.push('/phone')} />
        <Text className="mt-3 text-center text-xs text-ink-400">Login with your mobile number · No passwords</Text>
      </View>
    </View>
  );
}
