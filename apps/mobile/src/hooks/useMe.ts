import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Me } from '@/lib/types';

export function useMe() {
  const status = useAuth((s) => s.status);
  const setMe = useAuth((s) => s.setMe);
  return useQuery({
    queryKey: ['me'],
    enabled: status === 'signedIn',
    queryFn: async () => {
      const me = await api.get<Me>('/me');
      setMe(me);
      return me;
    },
    staleTime: 30_000,
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['me'] });
}

export function useBadges() {
  const status = useAuth((s) => s.status);
  return useQuery({
    queryKey: ['badges'],
    enabled: status === 'signedIn',
    queryFn: () => api.get<{ notifications: number; messages: number }>('/me/badges'),
    refetchInterval: 30_000,
  });
}
