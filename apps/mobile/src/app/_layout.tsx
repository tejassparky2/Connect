import '../../global.css';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { useMe } from '@/hooks/useMe';
import { usePushRegistration } from '@/hooks/usePush';
import { ConfirmHost, SheetHost, ToastHost } from '@/components/ui/Overlays';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      staleTime: 15_000,
    },
  },
});

/** Routes the user to the right place for their auth + onboarding state. */
function AuthGate() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);
  const segments = useSegments() as string[];
  const me = useMe();
  usePushRegistration();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedIn' && !me.data && !me.isError) return; // wait for profile
    SplashScreen.hideAsync().catch(() => undefined);
    const group = segments[0];
    if (status === 'signedOut') {
      if (group !== '(auth)') router.replace('/welcome');
      return;
    }
    const profile = me.data;
    if (!profile) return;
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
            <ToastHost />
            <ConfirmHost />
            <SheetHost />
          </View>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
