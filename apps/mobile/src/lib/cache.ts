import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { FeedPage, Post } from './types';

/** Apply a patch to a post wherever it's cached (feed pages, detail, my posts). */
export function patchPost(qc: QueryClient, id: string, patch: Partial<Post> | ((p: Post) => Partial<Post>)) {
  const apply = (p: Post) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p);
  qc.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['feed'] }, (data) =>
    data ? { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map(apply), pinnedAlerts: pg.pinnedAlerts.map(apply) })) } : data,
  );
  qc.setQueryData<Post>(['post', id], (p) => (p ? apply(p) : p));
  qc.setQueryData<{ items: Post[] }>(['my-posts'], (d) => (d ? { items: d.items.map(apply) } : d));
}

export function removePost(qc: QueryClient, id: string) {
  qc.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['feed'] }, (data) =>
    data ? { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.filter((p) => p.id !== id), pinnedAlerts: pg.pinnedAlerts.filter((p) => p.id !== id) })) } : data,
  );
  qc.setQueryData<{ items: Post[] }>(['my-posts'], (d) => (d ? { items: d.items.filter((p) => p.id !== id) } : d));
}
