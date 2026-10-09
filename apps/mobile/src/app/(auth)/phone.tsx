import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { normalizePhone } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button, Field, Icon, IconButton } from '@/components/ui';

export default function PhoneScreen() {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);

  const submit = async () => {
    const e164 = normalizePhone(phone);
    if (!e164) return setError('Enter a valid 10-digit mobile number');
    if (!consent) return toast.error('Please accept the privacy notice to continue');
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ phone: string; devCode?: string }>('/auth/otp/request', { phone: e164 });
      router.push({ pathname: '/otp', params: { phone: r.phone, devCode: r.devCode ?? '', consent: '1' } });
    } catch (e) {
      toast.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-3">
        <IconButton label="Back" name="arrow-back" onPress={() => router.back()} />
      </View>
      <View className="flex-1 px-6 pt-4">
        <Text className="text-3xl font-extrabold text-ink-900">What's your number?</Text>
        <Text className="mb-8 mt-2 text-base text-ink-500">We'll send a 6-digit OTP. Your number is never shown to neighbours.</Text>
        <Field
          testID="phone-input"
          label="Mobile number"
          prefix="🇮🇳 +91"
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoFocus
          maxLength={14}
          value={phone}
          onChangeText={(t) => {
            setPhone(t);
            setError(null);
          }}
          onSubmitEditing={submit}
          error={error}
        />
      </View>
      <View className="px-6" style={{ paddingBottom: insets.bottom + 20 }}>
        <Pressable testID="consent" accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} className="mb-4 flex-row items-start">
          <Icon name={consent ? 'checkbox' : 'square-outline'} size={22} color="#0F766E" />
          <Text className="ml-2 flex-1 text-xs leading-4 text-ink-600">
            I agree to the processing of my number, address and home location as described in the{' '}
            <Text onPress={() => router.push('/privacy')} className="font-semibold text-brand-700 underline">privacy notice</Text>. I can withdraw by deleting my account.
          </Text>
        </Pressable>
        <Button testID="send-otp" title="Send OTP" size="lg" loading={loading} disabled={phone.replace(/\D/g, '').length < 10 || !consent} onPress={submit} />
      </View>
    </KeyboardAvoidingView>
  );
}
