import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { TYPE_META } from '@/lib/constants';
import { formatDateTime, formatDistance, formatRupees, humanize, timeAgo } from '@/lib/format';
import type { Post } from '@/lib/types';
import { usePostActions } from '@/hooks/usePostActions';
import { Avatar, Card, Icon, Img, LevelBadge } from '@/components/ui';

export function PostCard({ post, detail = false, onDeleted }: { post: Post; detail?: boolean; onDeleted?: () => void }) {
  const { toggleLike, more } = usePostActions();
  const meta = TYPE_META[post.type];
  const isAlert = post.type === 'ALERT';
  const critical = isAlert && post.severity === 'CRITICAL';

  return (
    <Card testID={`post-${post.id}`} className={`mb-3 ${critical ? 'border-2 border-alert-500' : ''}`} onPress={detail ? undefined : () => router.push(`/post/${post.id}`)}>
      <View className="flex-row items-center">
        <Pressable accessibilityLabel={`${post.author.name}'s profile`} onPress={() => router.push(`/user/${post.author.id}`)}>
          <Avatar name={post.author.name} uri={post.author.avatarUrl} size={40} />
        </Pressable>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text numberOfLines={1} className="mr-1 flex-shrink text-[15px] font-bold text-ink-900">
              {post.author.name}
            </Text>
            <LevelBadge level={post.author.verificationLevel} compact />
          </View>
          <Text className="text-xs text-ink-500">
            {[post.author.neighborhood, post.distanceM != null ? formatDistance(post.distanceM) : null, timeAgo(post.createdAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable testID={`post-more-${post.id}`} accessibilityLabel="More options" hitSlop={10} onPress={() => more(post, { onDeleted })} className="h-8 w-8 items-center justify-center rounded-full active:bg-ink-100">
          <Icon name="ellipsis-horizontal" size={18} color="#64748B" />
        </Pressable>
      </View>

      <View className="mt-3 flex-row flex-wrap items-center">
        <View style={{ backgroundColor: meta.bg }} className="mr-2 rounded-full px-2.5 py-1">
          <Text style={{ color: meta.color }} className="text-xs font-bold">
            {isAlert && post.severity ? `${post.severity === 'CRITICAL' ? '🚨' : post.severity === 'WARNING' ? '⚠️' : 'ℹ️'} ${humanize(post.severity)} alert` : meta.label}
          </Text>
        </View>
        {post.hobbyTag ? <Text className="text-xs font-semibold text-saffron-700">#{post.hobbyTag}</Text> : null}
        {post.type === 'CLASSIFIED' && post.isSold ? (
          <View className="rounded-full bg-ink-900 px-2.5 py-1">
            <Text className="text-xs font-bold text-white">SOLD</Text>
          </View>
        ) : null}
      </View>

      {post.title ? <Text className="mt-2 text-[17px] font-bold leading-6 text-ink-900">{post.title}</Text> : null}
      <Text numberOfLines={detail ? undefined : 4} className="mt-1 text-[15px] leading-[22px] text-ink-700">
        {post.body}
      </Text>

      {post.type === 'CLASSIFIED' && post.pricePaise != null ? (
        <View className="mt-3 flex-row items-center">
          <Text className={`text-xl font-extrabold ${post.isSold ? 'text-ink-400 line-through' : 'text-brand-700'}`}>{post.pricePaise === 0 ? 'Free' : formatRupees(post.pricePaise)}</Text>
          {post.condition ? <Text className="ml-2 text-xs font-semibold text-ink-500">· {humanize(post.condition)}</Text> : null}
        </View>
      ) : null}

      {post.type === 'EVENT' && post.eventAt ? (
        <View className="mt-3 flex-row items-center rounded-2xl bg-pink-50 px-3 py-2">
          <Icon name="calendar" size={16} color="#BE185D" />
          <Text className="ml-2 text-sm font-semibold text-pink-700">{formatDateTime(post.eventAt)}</Text>
        </View>
      ) : null}

      {post.images.length ? (
        <View className="mt-3 overflow-hidden rounded-2xl">
          <Img source={{ uri: post.images[0] }} style={{ width: '100%', aspectRatio: detail ? 4 / 3 : 16 / 9 }} contentFit="cover" transition={200} />
          {post.images.length > 1 ? (
            <View className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5">
              <Text className="text-xs font-bold text-white">+{post.images.length - 1}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="mt-3 flex-row items-center border-t border-ink-100 pt-3">
        <Pressable testID={`like-${post.id}`} accessibilityRole="button" accessibilityLabel={`${post.likedByMe ? 'Remove thanks' : 'Thank'}, ${post.likeCount} thanks`} accessibilityState={{ selected: post.likedByMe }} onPress={() => toggleLike(post)} hitSlop={8} className="mr-6 flex-row items-center">
          <Icon name={post.likedByMe ? 'heart' : 'heart-outline'} size={20} color={post.likedByMe ? '#E11D48' : '#64748B'} />
          <Text className={`ml-1.5 text-sm font-semibold ${post.likedByMe ? 'text-rose-600' : 'text-ink-500'}`}>{post.likeCount || 'Thank'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${post.commentCount} replies`} onPress={() => router.push(`/post/${post.id}`)} hitSlop={8} className="mr-6 flex-row items-center">
          <Icon name="chatbubble-outline" size={19} color="#64748B" />
          <Text className="ml-1.5 text-sm font-semibold text-ink-500">{post.commentCount || 'Reply'}</Text>
        </Pressable>
        {!post.isMine && (post.type === 'CLASSIFIED' || post.type === 'LOST_FOUND' || post.type === 'HOBBY') ? (
          <Pressable
            testID={`message-${post.id}`}
            onPress={() => router.push({ pathname: '/messages/new', params: { userId: post.author.id, postId: post.id, name: post.author.name } })}
            className="ml-auto flex-row items-center rounded-full bg-brand-50 px-3 py-1.5"
          >
            <Icon name="chatbubble-ellipses" size={15} color="#0F766E" />
            <Text className="ml-1.5 text-sm font-semibold text-brand-800">{post.type === 'CLASSIFIED' ? 'Chat to buy' : 'Message'}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
