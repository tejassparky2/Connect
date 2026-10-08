import React from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useMe } from '@/hooks/useMe';
import { Composer } from '@/components/Composer';
import { Header } from '@/components/ui/Header';
import { EmptyState } from '@/components/ui';

/** First message to a neighbour (optionally about a post). Re-uses an existing thread server-side. */
export default function NewMessage() {
  const { userId, postId, name } = useLocalSearchParams<{ userId: string; postId?: string; name?: string }>();
  const qc = useQueryClient();
  const me = useMe();
  if (me.data?.verificationLevel === 'PHONE') {
    return (
      <View className="flex-1 bg-white">
        <Header title="Message" />
        <EmptyState emoji="📍" title="Verify to message neighbours" body="Messaging is limited to location-verified residents to prevent spam." action="Verify now" onAction={() => router.replace('/verify')} />
      </View>
    );
  }
  const send = async (body: string) => {
    try {
      const r = await api.post<{ id: string }>('/conversations', { userId, postId: postId || undefined, body });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      router.replace(`/messages/${r.id}`);
    } catch (e) {
      toast.error(e);
      throw e;
    }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-50">
      <Header title={name ? `Message ${name}` : 'New message'} />
      <View className="flex-1 items-center justify-center px-10">
        <Text className="text-4xl">👋</Text>
        <Text className="mt-3 text-center text-sm text-ink-500">Say hello! Keep it friendly — never share OTPs or pay in advance to strangers.</Text>
      </View>
      <Composer onSend={send} initial={postId ? 'Hi! Is this still available?' : ''} />
    </KeyboardAvoidingView>
  );
}
