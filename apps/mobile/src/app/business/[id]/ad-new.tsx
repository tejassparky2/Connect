import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatRupees } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Business, Campaign } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Button, Card, Chip, Field, Icon } from '@/components/ui';

const RADII = [1000, 2000, 3000, 5000];
const BUDGETS = [20000, 50000, 100000, 250000];
const DURATIONS = [3, 7, 14, 30];
const CTAS = [
  { k: 'WHATSAPP', l: '💬 WhatsApp' },
  { k: 'CALL', l: '📞 Call' },
  { k: 'VIEW_BUSINESS', l: '🏪 View shop' },
] as const;
const CPM = 5000; // ₹50 per 1,000 impressions

export default function AdBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const biz = useQuery({ queryKey: ['business', id], queryFn: () => api.get<Business>(`/businesses/${id}`) });
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [cta, setCta] = useState<(typeof CTAS)[number]['k']>('WHATSAPP');
  const [radiusM, setRadius] = useState(3000);
  const [budget, setBudget] = useState(50000);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null); // created draft, reused on retry
  const estimate = useQuery({ queryKey: ['ad-estimate', id, radiusM], queryFn: () => api.get<{ verifiedHouseholds: number }>(`/ads/estimate?businessId=${id}&radiusM=${radiusM}`) });

  const impressions = Math.floor((budget / CPM) * 1000);
  const submit = async (launch: boolean) => {
    if (headline.trim().length < 5) return toast.error('Headline needs at least 5 characters');
    if (body.trim().length < 10) return toast.error('Description needs at least 10 characters');
    setBusy(true);
    try {
      const c = draftId ? { id: draftId } : await api.post<Campaign>('/ads/campaigns', {
        businessId: id,
        headline: headline.trim(),
        body: body.trim(),
        cta,
        radiusM,
        budgetPaise: budget,
        cpmPaise: CPM,
        imageUrl: biz.data?.photos[0],
        endAt: new Date(Date.now() + days * 86400_000).toISOString(),
      });
      setDraftId(c.id);
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      if (launch) {
        const r = await api.post<Campaign>(`/ads/campaigns/${c.id}/launch`);
        toast.success(r.status === 'ACTIVE' ? 'Your ad is live! 🚀' : 'Submitted for review');
      } else toast.success('Saved as draft');
      qc.invalidateQueries({ queryKey: ['campaigns', id] });
      qc.invalidateQueries({ queryKey: ['wallet', id] });
      router.back();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-50">
      <Header title="Create local ad" subtitle={biz.data?.name} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Field testID="ad-headline" label="Headline" placeholder="☕ New in HSR: Filter Kaapi House" value={headline} onChangeText={setHeadline} maxLength={80} />
        <Field testID="ad-body" label="Message" placeholder="Authentic filter coffee 2 min from you. 20% off this week!" value={body} onChangeText={setBody} multiline maxLength={280} />
        <Text className="mb-2 text-sm font-semibold text-ink-700">Button</Text>
        <View className="mb-4 flex-row">{CTAS.map((c) => <Chip key={c.k} label={c.l} selected={cta === c.k} onPress={() => setCta(c.k)} />)}</View>

        <Text className="mb-2 text-sm font-semibold text-ink-700">Who should see it?</Text>
        <View className="mb-1 flex-row">{RADII.map((r) => <Chip key={r} testID={`radius-${r}`} label={`${r / 1000} km`} selected={radiusM === r} onPress={() => setRadius(r)} />)}</View>
        <View className="mb-4 flex-row items-center">
          <Icon name="people" size={14} color="#0F766E" />
          <Text testID="ad-reach" className="ml-1 text-xs text-brand-800">{estimate.data ? `${estimate.data.verifiedHouseholds.toLocaleString('en-IN')} verified households in range` : 'Estimating reach…'}</Text>
        </View>

        <Text className="mb-2 text-sm font-semibold text-ink-700">Total budget</Text>
        <View className="mb-1 flex-row flex-wrap">{BUDGETS.map((b) => <Chip key={b} testID={`budget-${b}`} label={formatRupees(b)} selected={budget === b} onPress={() => setBudget(b)} />)}</View>
        <Text className="mb-4 text-xs text-ink-500">≈ {impressions.toLocaleString('en-IN')} impressions at ₹50 per 1,000 views</Text>

        <Text className="mb-2 text-sm font-semibold text-ink-700">Duration</Text>
        <View className="mb-5 flex-row">{DURATIONS.map((d) => <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />)}</View>

        <Text className="mb-2 text-sm font-semibold text-ink-700">Preview</Text>
        <Card className="mb-5 border border-saffron-100">
          <Text className="text-xs font-bold uppercase tracking-wide text-saffron-600">Sponsored · Local</Text>
          <Text className="mt-1 text-[17px] font-bold text-ink-900">{headline || 'Your headline'}</Text>
          <Text className="mt-1 text-sm text-ink-600">{body || 'Your message to neighbours'}</Text>
          <View className="mt-3 items-center rounded-2xl bg-saffron-500 py-2.5"><Text className="font-semibold text-white">{CTAS.find((c) => c.k === cta)?.l}</Text></View>
        </Card>

        <Button testID="launch-ad" title={`Launch · ${formatRupees(budget)}`} size="lg" variant="saffron" icon="rocket" loading={busy} onPress={() => submit(true)} />
        <Button title="Save as draft" variant="ghost" className="mt-2" disabled={busy} onPress={() => submit(false)} />
        <Text className="mt-2 text-center text-xs text-ink-400">Budget is reserved from your wallet at launch. Unspent money is refunded when the campaign ends.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
