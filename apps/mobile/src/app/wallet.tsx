import { useEffect } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Return target of the hosted Razorpay checkout (mohalla://wallet?status=…). On Android the
 * redirect can arrive as a deep link instead of being captured by the auth session; bounce
 * back to the dashboard underneath and refresh wallet data.
 */
export default function WalletReturn() {
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['wallet'] });
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  }, [qc]);
  return null;
}
