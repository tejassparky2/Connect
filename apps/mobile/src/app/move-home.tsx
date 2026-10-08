import React from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { AddressForm } from '@/components/AddressForm';
import { Header } from '@/components/ui/Header';

export default function MoveHome() {
  return (
    <View className="flex-1 bg-white">
      <Header title="Update home address" subtitle="Moving resets your verification" />
      <View className="flex-1 pt-4">
        <AddressForm onDone={() => router.replace('/verify')} />
      </View>
    </View>
  );
}
