import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getFix } from '@/lib/location';
import { toast } from '@/lib/toast';
import type { Level } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { Button, Card, Icon, type IconName } from '@/components/ui';

interface Status {
  level: Level;
  address: { status: string; method: string | null } | null;
  gps: { passed: number; required: number; done: boolean; nextEligibleAt: string | null } | null;
  vouches: { count: number; required: number } | null;
}

function Step({ n, title, body, done, active, icon, children }: { n: number; title: string; body: string; done: boolean; active: boolean; icon: IconName; children?: React.ReactNode }) {
  return (
    <Card className={`mb-3 ${active ? 'border-2 border-brand-600' : ''}`}>
      <View className="flex-row items-start">
        <View className={`h-10 w-10 items-center justify-center rounded-2xl ${done ? 'bg-brand-700' : active ? 'bg-brand-50' : 'bg-ink-100'}`}>
          {done ? <Icon name="checkmark" size={20} color="#fff" /> : <Icon name={icon} size={20} color={active ? '#0F766E' : '#94A3B8'} />}
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-xs font-bold uppercase text-ink-400">Step {n}</Text>
          <Text className="text-base font-bold text-ink-900">{title}</Text>
          <Text className="mt-0.5 text-sm leading-5 text-ink-500">{body}</Text>
          {children}
        </View>
      </View>
    </Card>
  );
}

export default function Verify() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['verification'], queryFn: () => api.get<Status>('/me/verification') });
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const s = q.data;
  const waitUntil = s?.gps?.nextEligibleAt ? new Date(s.gps.nextEligibleAt) : null;
  const mustWait = !!waitUntil && waitUntil.getTime() > Date.now();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!mustWait) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000); // re-enable the button when the wait ends
    return () => clearInterval(t);
  }, [mustWait]);

  const check = async () => {
    setBusy(true);
    setReasons([]);
    try {
      const fix = await getFix();
      const r = await api.post<{ passed: boolean; reasons: string[]; level: Level; progress: { passed: number; required: number } }>('/me/verification/gps', fix);
      if (r.passed) toast.success(r.level === 'PHONE' ? `Check ${r.progress.passed}/${r.progress.required} passed ✓` : 'Location verified! 🎉 You can now post.');
      else setReasons(r.reasons);
      await q.refetch();
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const gpsDone = !!s?.gps?.done;
  return (
    <View className="flex-1 bg-ink-50">
      <Header title="Verification" subtitle="Keeps your mohalla real and safe" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
        <Step n={1} title="Mobile number" body="Verified with OTP." done active={false} icon="phone-portrait" />
        <Step n={2} title="Confirm you live here" body={`Run a quick GPS check while at home — ${s?.gps?.required ?? 2} checks a few hours apart (e.g. evening and morning). Fake-GPS apps are detected.`} done={gpsDone} active={!gpsDone} icon="location">
          {!s?.address ? (
            <Button title="Add home address" size="sm" className="mt-3 self-start" onPress={() => router.push('/move-home')} />
          ) : !gpsDone ? (
            <>
              <View className="mt-3 flex-row">
                {Array.from({ length: s?.gps?.required ?? 2 }).map((_, i) => (
                  <View key={i} className={`mr-1.5 h-2 flex-1 rounded-full ${i < (s?.gps?.passed ?? 0) ? 'bg-brand-600' : 'bg-ink-200'}`} />
                ))}
              </View>
              <Text className="mt-1 text-xs text-ink-500">{s?.gps?.passed ?? 0} of {s?.gps?.required ?? 2} checks done</Text>
              {mustWait ? <Text className="mt-2 text-xs font-semibold text-saffron-700">Next check available after {waitUntil!.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text> : null}
              <Button testID="gps-check" title="I'm at home — check now" icon="locate" size="sm" className="mt-3 self-start" loading={busy} disabled={mustWait} onPress={check} />
              {reasons.map((r) => <Text key={r} className="mt-2 text-xs text-alert-600">• {r}</Text>)}
            </>
          ) : null}
        </Step>
        <Step
          n={3}
          title="Verify your address"
          body="Any one of: your RWA approves you in your society group, join with your society's invite code, or get vouched by 2 verified neighbours."
          done={s?.level === 'ADDRESS'}
          active={gpsDone && s?.level !== 'ADDRESS'}
          icon="home"
        >
          {s?.level !== 'ADDRESS' ? (
            <>
              <Text className="mt-2 text-xs text-ink-500">Neighbour vouches: {s?.vouches?.count ?? 0}/{s?.vouches?.required ?? 2}</Text>
              <Button title="Join my society" icon="business" size="sm" variant="secondary" className="mt-3 self-start" onPress={() => router.push('/society/join')} />
            </>
          ) : null}
        </Step>
        <Card className="mt-2 bg-ink-900">
          <Text className="font-bold text-white">🔒 Your privacy</Text>
          <Text className="mt-1 text-sm leading-5 text-ink-300">Your exact home location is used only to verify you and to centre your feed. Neighbours see your area — never your flat or phone number.</Text>
        </Card>
      </ScrollView>
    </View>
  );
}
