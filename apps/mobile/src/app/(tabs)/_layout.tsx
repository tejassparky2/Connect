import React from 'react';
import { Platform, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { router } from 'expo-router';
import { Icon, type IconName } from '@/components/ui';
import { useMe } from '@/hooks/useMe';

const tabIcon = (name: IconName, active: IconName) =>
  function TabIcon({ focused, color }: { focused: boolean; color: unknown }) {
    return <Icon name={focused ? active : name} size={24} color={color as string} />;
  };

export default function TabsLayout() {
  const me = useMe();
  const pending = me.data?.societies.some((s) => s.status === 'PENDING');
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0F766E',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { borderTopColor: '#F1F5F9', height: Platform.OS === 'ios' ? 88 : 64, paddingTop: 6, paddingBottom: Platform.OS === 'ios' ? 28 : 8 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home'), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="explore" options={{ title: 'Local', tabBarIcon: tabIcon('storefront-outline', 'storefront'), tabBarButtonTestID: 'tab-local' }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Post',
          tabBarButtonTestID: 'tab-create',
          tabBarIcon: () => (
            <View className="-mt-1 h-11 w-11 items-center justify-center rounded-2xl bg-brand-700">
              <Icon name="add" size={26} color="#fff" />
            </View>
          ),
          tabBarLabel: () => null,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/post/create');
          },
        }}
      />
      <Tabs.Screen name="society" options={{ title: 'Society', tabBarIcon: tabIcon('business-outline', 'business'), tabBarBadge: pending ? '•' : undefined, tabBarButtonTestID: 'tab-society' }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: tabIcon('person-circle-outline', 'person-circle'), tabBarButtonTestID: 'tab-profile' }} />
    </Tabs>
  );
}
