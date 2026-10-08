import { ActivityIndicator, View } from 'react-native';

/** Entry: AuthGate in _layout redirects from here once auth state is known. */
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-brand-700">
      <ActivityIndicator color="#fff" />
    </View>
  );
}
