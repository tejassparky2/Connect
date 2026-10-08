import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddressForm } from '@/components/AddressForm';

export default function AddressSetup() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top + 24 }}>
      <AddressForm step="Step 2 of 2" />
    </View>
  );
}
