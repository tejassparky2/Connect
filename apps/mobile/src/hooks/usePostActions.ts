import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { patchPost, removePost } from '@/lib/cache';
import { toast } from '@/lib/toast';
import type { Post } from '@/lib/types';
import { confirm, openSheet, type SheetAction } from '@/components/ui/Overlays';

export function usePostActions() {
  const qc = useQueryClient();

  const toggleLike = async (p: Post) => {
    const liked = !p.likedByMe;
    patchPost(qc, p.id, { likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) }); // optimistic
    try {
      const r = liked ? await api.post<{ likeCount: number }>(`/posts/${p.id}/like`) : await api.del<{ likeCount: number }>(`/posts/${p.id}/like`);
      patchPost(qc, p.id, { likedByMe: liked, likeCount: r.likeCount });
    } catch (e) {
      patchPost(qc, p.id, { likedByMe: p.likedByMe, likeCount: p.likeCount });
      toast.error(e);
    }
  };

  const report = async (p: Post) => {
    try {
      const r = await api.post<{ message: string }>('/reports', { targetType: 'POST', targetId: p.id, reason: 'INAPPROPRIATE' });
      toast.success(r.message);
    } catch (e) {
      toast.error(e);
    }
  };

  const more = (p: Post, opts: { onDeleted?: () => void } = {}) => {
    const actions: SheetAction[] = [];
    if (p.isMine) {
      if (p.type === 'CLASSIFIED')
        actions.push({
          label: p.isSold ? 'Mark as available' : 'Mark as sold',
          icon: p.isSold ? 'refresh' : 'checkmark-done',
          onPress: async () => {
            try {
              const u = await api.patch<Post>(`/posts/${p.id}`, { isSold: !p.isSold });
              patchPost(qc, p.id, { isSold: u.isSold });
              toast.success(u.isSold ? 'Marked as sold 🎉' : 'Listing is available again');
            } catch (e) {
              toast.error(e);
            }
          },
        });
      actions.push({
        label: 'Delete post',
        icon: 'trash',
        destructive: true,
        onPress: async () => {
          if (!(await confirm('Delete this post?', 'This cannot be undone.', { confirmText: 'Delete', destructive: true }))) return;
          try {
            await api.del(`/posts/${p.id}`);
            removePost(qc, p.id);
            toast.success('Post deleted');
            opts.onDeleted?.();
          } catch (e) {
            toast.error(e);
          }
        },
      });
    } else {
      actions.push({ label: `Message ${p.author.name.split(' ')[0]}`, icon: 'chatbubble-ellipses', onPress: () => router.push({ pathname: '/messages/new', params: { userId: p.author.id, postId: p.id, name: p.author.name } }) });
      actions.push({ label: 'View profile', icon: 'person', onPress: () => router.push(`/user/${p.author.id}`) });
      actions.push({ label: 'Report post', icon: 'flag', destructive: true, onPress: () => report(p) });
      actions.push({
        label: `Block ${p.author.name.split(' ')[0]}`,
        icon: 'ban',
        destructive: true,
        onPress: async () => {
          if (!(await confirm(`Block ${p.author.name}?`, "You won't see each other's posts or messages.", { confirmText: 'Block', destructive: true }))) return;
          try {
            await api.post(`/users/${p.author.id}/block`);
            qc.invalidateQueries({ queryKey: ['feed'] });
            toast.success('User blocked');
            opts.onDeleted?.();
          } catch (e) {
            toast.error(e);
          }
        },
      });
    }
    openSheet(actions);
  };

  return { toggleLike, more };
}
