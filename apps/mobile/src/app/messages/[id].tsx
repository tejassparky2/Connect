import React, { useEffect, useMemo } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatRupees } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Message, PublicUser } from '@/lib/types';
import { Composer } from '@/components/Composer';
import { Header } from '@/components/ui/Header';
import { Avatar, Img } from '@/components/ui';

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const conv = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<{ id: string; other: PublicUser; post: { id: string; title: string | null; pricePaise: number | null; images: string[]; isSold: boolean } | null }>(`/conversations/${id}`),
  });
  // Poll for new messages (WebSocket upgrade path documented in ARCHITECTURE.md).
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => api.get<{ items: Message[] }>(`/conversations/${id}/messages?limit=100`), refetchInterval: 4000 });

  const lastId = msgs.data?.items[0]?.id;
  useEffect(() => {
    if (!lastId) return;
    api.post(`/conversations/${id}/read`).then(() => {
      qc.invalidateQueries({ queryKey: ['badges'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    }).catch(() => undefined);
  }, [id, lastId, qc]);

  const items = useMemo(() => msgs.data?.items ?? [], [msgs.data]);
  const send = async (body: string) => {
    try {
      const m = await api.post<Message>(`/conversations/${id}/messages`, { body });
      await qc.cancelQueries({ queryKey: ['messages', id] }); // an in-flight poll must not overwrite this
      qc.setQueryData<{ items: Message[] }>(['messages', id], (d) => ({ items: [m, ...(d?.items ?? [])] }));
    } catch (e) {
      toast.error(e);
      throw e;
    }
  };

  const other = conv.data?.other;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-50">
      <Header
        title={other?.name ?? 'Chat'}
        subtitle={other?.neighborhood ?? undefined}
        right={other ? <Pressable accessibilityLabel={`${other.name}'s profile`} onPress={() => router.push(`/user/${other.id}`)} className="mr-2"><Avatar name={other.name} uri={other.avatarUrl} size={34} /></Pressable> : null}
      />
      {conv.data?.post ? (
        <Pressable onPress={() => router.push(`/post/${conv.data!.post!.id}`)} className="flex-row items-center border-b border-ink-100 bg-white px-4 py-2.5">
          {conv.data.post.images[0] ? <Img source={{ uri: conv.data.post.images[0] }} style={{ width: 40, height: 40, borderRadius: 10 }} /> : null}
          <View className="ml-3 flex-1">
            <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{conv.data.post.title}</Text>
            <Text className="text-xs text-brand-700">{conv.data.post.isSold ? 'Sold' : formatRupees(conv.data.post.pricePaise)}</Text>
          </View>
        </Pressable>
      ) : null}
      <FlatList
        testID="message-list"
        inverted
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <View className={`mb-2 max-w-[80%] rounded-3xl px-4 py-2.5 ${item.isMine ? 'self-end rounded-br-md bg-brand-700' : 'self-start rounded-bl-md bg-white'}`}>
            <Text className={`text-[15px] leading-5 ${item.isMine ? 'text-white' : 'text-ink-900'}`}>{item.body}</Text>
            <Text className={`mt-0.5 text-right text-[10px] ${item.isMine ? 'text-brand-100' : 'text-ink-400'}`}>
              {new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
            </Text>
          </View>
        )}
      />
      <Composer onSend={send} />
    </KeyboardAvoidingView>
  );
}
