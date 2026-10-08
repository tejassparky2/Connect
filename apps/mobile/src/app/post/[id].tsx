import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { patchPost } from '@/lib/cache';
import { timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Comment, Post } from '@/lib/types';
import { useMe } from '@/hooks/useMe';
import { PostCard } from '@/components/PostCard';
import { Header } from '@/components/ui/Header';
import { confirm } from '@/components/ui/Overlays';
import { Avatar, EmptyState, Icon, LevelBadge } from '@/components/ui';

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useMe();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const post = useQuery({ queryKey: ['post', id], queryFn: () => api.get<Post>(`/posts/${id}`) });
  const comments = useQuery({ queryKey: ['comments', id], queryFn: () => api.get<{ items: Comment[] }>(`/posts/${id}/comments`), enabled: post.isSuccess });

  const send = async () => {
    if (!text.trim()) return;
    if (me.data?.verificationLevel === 'PHONE') return router.push('/verify');
    setSending(true);
    try {
      const c = await api.post<Comment>(`/posts/${id}/comments`, { body: text.trim() });
      qc.setQueryData<{ items: Comment[] }>(['comments', id], (d) => ({ items: [...(d?.items ?? []), c] }));
      patchPost(qc, id, (p) => ({ commentCount: p.commentCount + 1 }));
      setText('');
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  };

  const remove = async (c: Comment) => {
    if (!(await confirm('Delete comment?', undefined, { confirmText: 'Delete', destructive: true }))) return;
    try {
      await api.del(`/comments/${c.id}`);
      qc.setQueryData<{ items: Comment[] }>(['comments', id], (d) => ({ items: (d?.items ?? []).filter((x) => x.id !== c.id) }));
      patchPost(qc, id, (p) => ({ commentCount: Math.max(0, p.commentCount - 1) }));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-50">
      <Header title="Post" />
      {post.isLoading ? (
        <ActivityIndicator className="mt-10" color="#0F766E" />
      ) : post.isError || !post.data ? (
        <EmptyState emoji="🫥" title="Post not available" body="It may have been removed or is outside your neighbourhood." />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <PostCard post={post.data} detail onDeleted={() => router.back()} />
            <Text className="mb-2 mt-2 text-base font-bold text-ink-900">{post.data.commentCount ? `${post.data.commentCount} replies` : 'Replies'}</Text>
            {comments.data?.items.length === 0 ? <Text className="py-6 text-center text-sm text-ink-400">No replies yet. Start the conversation!</Text> : null}
            {comments.data?.items.map((c) => (
              <View key={c.id} testID={`comment-${c.id}`} className="mb-3 flex-row">
                <Avatar name={c.author.name} uri={c.author.avatarUrl} size={34} />
                <View className="ml-2 flex-1 rounded-2xl rounded-tl-sm bg-white px-3 py-2">
                  <View className="flex-row items-center">
                    <Text className="mr-1 text-sm font-bold text-ink-900">{c.author.name}</Text>
                    <LevelBadge level={c.author.verificationLevel} compact />
                    <Text className="ml-auto text-xs text-ink-400">{timeAgo(c.createdAt)}</Text>
                  </View>
                  <Text className="mt-0.5 text-[15px] leading-5 text-ink-700">{c.body}</Text>
                  {c.isMine || post.data?.isMine ? (
                    <Pressable onPress={() => remove(c)} className="mt-1 self-start">
                      <Text className="text-xs font-semibold text-ink-400">Delete</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>
          <View className="flex-row items-end border-t border-ink-100 bg-white px-3 pt-2" style={{ paddingBottom: insets.bottom + 8 }}>
            <TextInput
              testID="comment-input"
              value={text}
              onChangeText={setText}
              placeholder={me.data?.verificationLevel === 'PHONE' ? 'Verify your location to reply' : 'Write a reply…'}
              placeholderTextColor="#94A3B8"
              multiline
              maxLength={1000}
              className="max-h-28 min-h-[44px] flex-1 rounded-2xl bg-ink-100 px-4 py-3 text-base text-ink-900"
            />
            <Pressable testID="send-comment" accessibilityLabel="Send reply" onPress={send} disabled={sending || !text.trim()} className={`ml-2 h-11 w-11 items-center justify-center rounded-full ${text.trim() ? 'bg-brand-700' : 'bg-ink-200'}`}>
              {sending ? <ActivityIndicator color="#fff" /> : <Icon name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
