import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

/**
 * Returns whether the current user is part of any approval flow.
 * Result is cached for 5 minutes to avoid repeated calls.
 */
export function useCanApprove(): boolean | undefined {
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery<{ canApprove: boolean }>({
    queryKey: ['can-approve', user?.id],
    queryFn: () => api.get('/aprobaciones/can-approve').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });
  return data?.canApprove;
}
