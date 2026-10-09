import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatRupees, humanize, timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Business, Campaign } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { confirm } from '@/components/ui/Overlays';
import { Button, Card, Chip, Field, Icon, Pill, SectionTitle } from '@/components/ui';

interface Wallet {
  balancePaise: number;
  paymentsMode: 'razorpay' | 'dev' | 'disabled';
  transactions: { id: string; type: string; amountPaise: number; note: string | null; createdAt: string }[];
}

const TOPUPS = [50000, 100000, 250000, 500000];
const STATUS_TONE: Record<Campaign['status'], 'brand' | 'saffron' | 'neutral' | 'danger'> = {
  ACTIVE: 'brand', PENDING_REVIEW: 'saffron', PAUSED: 'neutral', DRAFT: 'neutral', EXHAUSTED: 'neutral', ENDED: 'neutral', REJECTED: 'danger',
};

export default function ManageBusiness() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const biz = useQuery({ queryKey: ['business', id], queryFn: () => api.get<Business>(`/businesses/${id}`) });
  const wallet = useQuery({ queryKey: ['wallet', id], queryFn: () => api.get<Wallet>(`/businesses/${id}/wallet`) });
  const campaigns = useQuery({ queryKey: ['campaigns', id], queryFn: () => api.get<{ items: Campaign[] }>(`/ads/campaigns?businessId=${id}`) });
  const [amount, setAmount] = useState(100000);
  const [paying, setPaying] = useState(false);
  const [offer, setOffer] = useState({ title: '', body: '' });
  const [posting, setPosting] = useState(false);

  const topUp = async () => {
    setPaying(true);
    try {
      const order = await api.post<{ mode: string; orderId: string; amountPaise: number; checkoutUrl?: string }>(`/businesses/${id}/wallet/orders`, { amountPaise: amount });
      if (order.mode === 'dev') {
        await api.post(`/businesses/${id}/wallet/verify`, { orderId: order.orderId, paymentId: `dev_pay_${Date.now()}`, signature: 'dev-signature', amountPaise: amount });
        toast.success(`${formatRupees(amount)} added (test mode)`);
      } else if (order.checkoutUrl) {
        // Razorpay Checkout (UPI / cards / netbanking) in a secure browser session.
        const before = wallet.data?.balancePaise ?? 0;
        await WebBrowser.openAuthSessionAsync(order.checkoutUrl, 'mohalla://wallet');
        toast.info('Checking payment status…');
        // The webhook may land a few seconds after the browser closes: poll briefly.
        for (let i = 0; i < 5; i++) {
          const w = await wallet.refetch();
          if ((w.data?.balancePaise ?? 0) > before) {
            toast.success('Money added to your wallet');
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      await wallet.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setPaying(false);
    }
  };

  const postOffer = async () => {
    if (offer.title.trim().length < 3 || offer.body.trim().length < 5) return toast.error('Add a title and a short description');
    setPosting(true);
    try {
      await api.post(`/businesses/${id}/announcements`, { title: offer.title.trim(), body: offer.body.trim(), validUntil: new Date(Date.now() + 7 * 86400_000).toISOString() });
      setOffer({ title: '', body: '' });
      toast.success('Offer published to nearby neighbours');
      qc.invalidateQueries({ queryKey: ['business', id] });
      qc.invalidateQueries({ queryKey: ['offers'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setPosting(false);
    }
  };

  const act = async (c: Campaign, action: 'launch' | 'pause' | 'resume' | 'end') => {
    if (action === 'end' && !(await confirm('End this campaign?', 'Unspent budget is refunded to your wallet.', { confirmText: 'End campaign', destructive: true }))) return;
    try {
      const r = await api.post<Campaign>(`/ads/campaigns/${c.id}/${action}`);
      toast.success(action === 'launch' ? (r.status === 'ACTIVE' ? 'Your ad is live! 🚀' : 'Submitted for review') : `Campaign ${humanize(r.status).toLowerCase()}`);
      campaigns.refetch();
      wallet.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  const refreshing = wallet.isRefetching || campaigns.isRefetching;
  return (
    <View className="flex-1 bg-ink-50">
      <Header title="Business dashboard" subtitle={biz.data?.name} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { wallet.refetch(); campaigns.refetch(); }} />}>
        <Card className="bg-ink-900" testID="wallet-card">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-300">Ad wallet balance</Text>
          {wallet.isLoading ? <ActivityIndicator color="#fff" /> : <Text testID="wallet-balance" className="mt-1 text-3xl font-extrabold text-white">{formatRupees(wallet.data?.balancePaise ?? 0) || '₹0'}</Text>}
          <View className="mt-4 flex-row flex-wrap">
            {TOPUPS.map((t) => (
              <Pressable key={t} testID={`topup-${t}`} onPress={() => setAmount(t)} className={`mb-2 mr-2 rounded-full px-3.5 py-1.5 ${amount === t ? 'bg-saffron-500' : 'bg-white/10'}`}>
                <Text className="text-sm font-semibold text-white">{formatRupees(t)}</Text>
              </Pressable>
            ))}
          </View>
          <Button testID="add-money" title={`Add ${formatRupees(amount)}`} variant="saffron" icon="add-circle" className="mt-2" loading={paying} disabled={wallet.data?.paymentsMode === 'disabled'} onPress={topUp} />
          <Text className="mt-2 text-center text-[11px] text-ink-400">{wallet.data?.paymentsMode === 'dev' ? 'Test mode — no real money is charged' : 'Secure payments by Razorpay · UPI, cards, netbanking'}</Text>
        </Card>

        <SectionTitle title="Ad campaigns" action="+ New ad" onAction={() => router.push(`/business/${id}/ad-new`)} />
        {campaigns.data?.items.length === 0 ? (
          <Card className="items-center py-6">
            <Text className="text-3xl">📣</Text>
            <Text className="mt-2 text-center font-bold text-ink-900">Reach neighbours within 1–5 km</Text>
            <Text className="mt-1 text-center text-sm text-ink-500">Ads appear in the home feed of verified residents near your shop. Start from ₹100.</Text>
            <Button testID="create-ad" title="Create your first ad" className="mt-4" onPress={() => router.push(`/business/${id}/ad-new`)} />
          </Card>
        ) : null}
        {campaigns.data?.items.map((c) => (
          <Card key={c.id} testID={`campaign-${c.id}`} className="mb-3">
            <View className="flex-row items-center">
              <Text numberOfLines={1} className="mr-2 flex-1 text-base font-bold text-ink-900">{c.headline}</Text>
              <Pill text={humanize(c.status)} tone={STATUS_TONE[c.status]} />
            </View>
            {c.rejectReason ? <Text className="mt-1 text-xs text-alert-600">{c.rejectReason}</Text> : null}
            <View className="mt-3 flex-row">
              {[
                { l: 'Impressions', v: c.impressions.toLocaleString('en-IN') },
                { l: 'Clicks', v: String(c.clicks) },
                { l: 'CTR', v: `${c.ctr}%` },
                { l: 'Spent', v: formatRupees(c.spentPaise) || '₹0' },
              ].map((s) => (
                <View key={s.l} className="flex-1">
                  <Text className="text-[15px] font-extrabold text-ink-900">{s.v}</Text>
                  <Text className="text-[11px] text-ink-500">{s.l}</Text>
                </View>
              ))}
            </View>
            <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <View className="h-full bg-saffron-500" style={{ width: `${Math.min(100, (c.spentPaise / c.budgetPaise) * 100)}%` }} />
            </View>
            <Text className="mt-1 text-[11px] text-ink-400">{formatRupees(c.remainingPaise)} left of {formatRupees(c.budgetPaise)} · {(c.radiusM / 1000).toFixed(1)} km · ends {new Date(c.endAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            <View className="mt-3 flex-row">
              {c.status === 'DRAFT' ? <Button testID={`launch-${c.id}`} title="Launch" size="sm" icon="rocket" className="mr-2" onPress={() => act(c, 'launch')} /> : null}
              {c.status === 'ACTIVE' ? <Button title="Pause" size="sm" variant="outline" icon="pause" className="mr-2" onPress={() => act(c, 'pause')} /> : null}
              {c.status === 'PAUSED' ? <Button title="Resume" size="sm" icon="play" className="mr-2" onPress={() => act(c, 'resume')} /> : null}
              {['DRAFT', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW'].includes(c.status) ? <Button title="End" size="sm" variant="ghost" onPress={() => act(c, 'end')} /> : null}
            </View>
          </Card>
        ))}

        <SectionTitle title="Post an offer" />
        <Card>
          <Field testID="offer-title" label="Headline" placeholder="Grand opening: 20% off!" value={offer.title} onChangeText={(t) => setOffer((o) => ({ ...o, title: t }))} maxLength={80} />
          <Field testID="offer-body" label="Details" placeholder="Valid on all orders this week" value={offer.body} onChangeText={(t) => setOffer((o) => ({ ...o, body: t }))} multiline maxLength={500} />
          <Button testID="post-offer" title="Publish offer (free)" variant="secondary" icon="megaphone" loading={posting} onPress={postOffer} />
        </Card>

        <SectionTitle title="Wallet history" />
        <Card>
          {wallet.data?.transactions.length === 0 ? <Text className="text-sm text-ink-400">No transactions yet</Text> : null}
          {wallet.data?.transactions.map((t) => (
            <View key={t.id} className="flex-row items-center border-b border-ink-100 py-2.5">
              <Icon name={t.amountPaise > 0 ? 'arrow-down-circle' : 'arrow-up-circle'} size={20} color={t.amountPaise > 0 ? '#0F766E' : '#D96306'} />
              <View className="ml-2 flex-1">
                <Text className="text-sm font-semibold text-ink-800">{t.note ?? humanize(t.type)}</Text>
                <Text className="text-xs text-ink-400">{timeAgo(t.createdAt)}</Text>
              </View>
              <Text className={`text-sm font-bold ${t.amountPaise > 0 ? 'text-brand-700' : 'text-ink-700'}`}>{t.amountPaise > 0 ? '+' : '−'}{formatRupees(Math.abs(t.amountPaise))}</Text>
            </View>
          ))}
        </Card>
        <Button title="View public page" variant="ghost" className="mt-4" onPress={() => router.push(`/business/${id}`)} />
      </ScrollView>
    </View>
  );
}
