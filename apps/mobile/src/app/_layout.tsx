import '../../global.css';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onSignOut, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { useMe } from '@/hooks/useMe';
import { NotificationTapRouter, usePushRegistration } from '@/hooks/usePush';
import { Button } from '@/components/ui';
import { ConfirmHost, SheetHost, ToastHost } from '@/components/ui/Overlays';
import { ServerSheetHost } from '@/components/ServerSettings';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
onSignOut(() => queryClient.clear());

/** Routes the user to the right place for their auth + onboarding state. */
function AuthGate() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);
  const signOut = useAuth((s) => s.signOut);
  const segments = useSegments() as string[];
  const me = useMe();
  usePushRegistration();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // A revoked session or suspended account can't recover by retrying: sign out.
  useEffect(() => {
    const e = me.error;
    if (status === 'signedIn' && e instanceof ApiError && (e.status === 401 || e.status === 403)) signOut();
  }, [me.error, status, signOut]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedIn' && !me.data && !me.isError) return; // wait for profile
    SplashScreen.hideAsync().catch(() => undefined);
    const group = segments[0];
    if (status === 'signedOut') {
      if (group !== '(auth)' && group !== 'privacy') router.replace('/welcome'); // privacy notice readable before sign-up
      return;
    }
    const profile = me.data;
    if (!profile) return; // BootError (below) handles a failed profile load
    if (!profile.name) {
      if (segments[1] !== 'profile-setup') router.replace('/profile-setup');
    } else if (!profile.hasHome) {
      if (segments[1] !== 'address-setup') router.replace('/address-setup');
    } else if (group === '(auth)' || group === '(onboarding)' || group === undefined) {
      router.replace('/(tabs)');
    }
  }, [status, me.data, me.isError, segments]);

  return null;
}

/** Shown when signed in but the profile can't load (offline, server down) — instead of an endless spinner. */
function BootError() {
  const status = useAuth((s) => s.status);
  const me = useMe();
  if (status !== 'signedIn' || me.data || !me.isError) return null;
  const offline = me.error instanceof ApiError && me.error.code === 'NETWORK';
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 500 }]} className="items-center justify-center bg-white px-10">
      <Text className="text-5xl">{offline ? '📡' : '🛠️'}</Text>
      <Text className="mt-4 text-center text-xl font-extrabold text-ink-900">{offline ? "You're offline" : 'Something went wrong'}</Text>
      <Text className="mt-2 text-center text-sm leading-5 text-ink-500">{offline ? 'Check your internet connection and try again.' : 'We couldn’t load your profile. Please try again in a moment.'}</Text>
      <Button testID="boot-retry" title="Try again" className="mt-6 self-stretch" loading={me.isFetching} onPress={() => me.refetch()} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <View style={{ flex: 1, backgroundColor: '#F8FAFC' }} className={Platform.OS === 'web' ? 'mx-auto w-full max-w-[520px]' : ''}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8FAFC' }, animation: 'slide_from_right' }}>
              <Stack.Screen name="post/create" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            </Stack>
            <AuthGate />
            {Platform.OS !== 'web' ? <NotificationTapRouter /> : null}
            <BootError />
            {/* Order matters: later = on top. */}
            <SheetHost />
            <ServerSheetHost />
            <ConfirmHost />
            <ToastHost />
          </View>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
