import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prettyPhone } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Me } from '@/lib/types';
import { Button, IconButton } from '@/components/ui';

export default function OtpScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ phone: string; devCode?: string; consent?: string }>();
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(params.devCode || '');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(30);
  const input = useRef<TextInput>(null);
  const signIn = useAuth((s) => s.signIn);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const inFlight = useRef(false);
  const verify = async (value = code) => {
    if (value.length !== 6 || inFlight.current) return; // autofill + tap can fire twice
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string; user: Me }>('/auth/otp/verify', { phone: params.phone, code: value, consent: params.consent === '1' });
      qc.setQueryData(['me'], r.user);
      await signIn(r.accessToken, r.refreshToken, r.user);
      // AuthGate takes it from here (profile → address → home).
    } catch (e) {
      toast.error(e);
      setCode('');
      input.current?.focus();
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      const r = await api.post<{ devCode?: string }>('/auth/otp/request', { phone: params.phone });
      setDevCode(r.devCode ?? '');
      setCooldown(30);
      toast.success('OTP sent again');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-3">
        <IconButton label="Back" name="arrow-back" onPress={() => router.back()} />
      </View>
      <View className="flex-1 px-6 pt-4">
        <Text className="text-3xl font-extrabold text-ink-900">Enter OTP</Text>
        <Text className="mb-8 mt-2 text-base text-ink-500">Sent to {params.phone ? prettyPhone(params.phone) : 'your phone'}</Text>

        <Pressable onPress={() => input.current?.focus()} className="flex-row justify-between">
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} className={`h-14 w-12 items-center justify-center rounded-2xl border-2 ${code.length === i ? 'border-brand-700' : 'border-ink-200'} bg-ink-50`}>
              <Text className="text-2xl font-bold text-ink-900">{code[i] ?? ''}</Text>
            </View>
          ))}
        </Pressable>
        <TextInput
          testID="otp-input"
          ref={input}
          value={code}
          onChangeText={(t) => {
            const v = t.replace(/\D/g, '').slice(0, 6);
            setCode(v);
            if (v.length === 6) verify(v);
          }}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          autoFocus
          maxLength={6}
          style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
        />

        {devCode ? (
          <View className="mt-6 rounded-2xl bg-saffron-50 p-4">
            <Text className="text-xs font-semibold uppercase tracking-wide text-saffron-700">Development mode</Text>
            <Text className="mt-1 text-sm text-ink-700">
              Your OTP is <Text testID="dev-code" className="font-bold">{devCode}</Text>
            </Text>
          </View>
        ) : null}

        <View className="mt-6 flex-row items-center">
          <Text className="text-sm text-ink-500">Didn't get it? </Text>
          {cooldown > 0 ? (
            <Text className="text-sm font-semibold text-ink-400">Resend in {cooldown}s</Text>
          ) : (
            <Pressable onPress={resend} hitSlop={12} accessibilityRole="button">
              <Text className="text-sm font-semibold text-brand-700">Resend OTP</Text>
            </Pressable>
          )}
        </View>
      </View>
      <View className="px-6" style={{ paddingBottom: insets.bottom + 20 }}>
        <Button testID="verify-otp" title="Verify & continue" size="lg" loading={loading} disabled={code.length !== 6} onPress={() => verify()} />
      </View>
    </KeyboardAvoidingView>
  );
}
