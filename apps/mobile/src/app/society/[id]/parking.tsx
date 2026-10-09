import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { ParkingAlert } from '@/lib/types';
import { Header } from '@/components/ui/Header';
import { BottomSheet, confirm } from '@/components/ui/Overlays';
import { Button, Card, Chip, Field, Icon, IconButton, SectionTitle } from '@/components/ui';

interface Vehicle { id: string; number: string; label: string | null }
const QUICK = ['Your vehicle is blocking mine. Please move it.', 'Headlights are on', 'Parked in my slot', 'Car alarm going off'];
const fmtPlate = (n: string) => n.replace(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/, '$1 $2 $3 $4').replace(/\s+/g, ' ');

export default function Parking() {
  const { id, report } = useLocalSearchParams<{ id: string; report?: string }>();
  const alerts = useQuery({ queryKey: ['parking', id], queryFn: () => api.get<{ items: ParkingAlert[] }>(`/societies/${id}/parking-alerts`), refetchInterval: 20_000 });
  const vehicles = useQuery({ queryKey: ['vehicles', id], queryFn: () => api.get<{ items: Vehicle[] }>(`/societies/${id}/vehicles`) });
  const [open, setOpen] = useState(report === '1');
  const [plate, setPlate] = useState('');
  const [message, setMessage] = useState(QUICK[0]);
  const [location, setLocation] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ ownerNotified: boolean }>(`/societies/${id}/parking-alerts`, { vehicleNumber: plate, message, location: location.trim() || undefined });
      toast.success(r.ownerNotified ? 'Owner notified instantly 🔔' : 'Vehicle not registered — security & committee alerted');
      setOpen(false);
      setPlate('');
      setLocation('');
      alerts.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (a: ParkingAlert) => {
    try {
      await api.post(`/societies/${id}/parking-alerts/${a.id}/resolve`);
      toast.success('Marked as resolved');
      alerts.refetch();
    } catch (e) {
      toast.error(e);
    }
  };
  const addVehicle = async () => {
    try {
      await api.post(`/societies/${id}/vehicles`, { number: newPlate, label: newLabel.trim() || undefined });
      setNewPlate('');
      setNewLabel('');
      toast.success('Vehicle added — you’ll be alerted if it blocks someone');
      vehicles.refetch();
    } catch (e) {
      toast.error(e);
    }
  };
  const removeVehicle = async (v: Vehicle) => {
    if (!(await confirm(`Remove ${fmtPlate(v.number)}?`, undefined, { confirmText: 'Remove', destructive: true }))) return;
    await api.del(`/societies/${id}/vehicles/${v.id}`).catch(toast.error);
    vehicles.refetch();
  };

  return (
    <View className="flex-1 bg-ink-50">
      <Header title="Parking" right={<Button testID="report-parking" title="Report" size="sm" variant="danger" icon="car" className="mr-2" onPress={() => setOpen(true)} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={alerts.isRefetching} onRefresh={() => { alerts.refetch(); vehicles.refetch(); }} />}>
        {alerts.data?.items.length === 0 ? (
          <Card className="items-center py-6"><Text className="text-3xl">🅿️</Text><Text className="mt-2 font-bold text-ink-900">No parking issues</Text><Text className="text-center text-sm text-ink-500">Blocked in? Report the vehicle number — the owner gets an instant alert without anyone sharing phone numbers.</Text></Card>
        ) : null}
        {alerts.data?.items.map((a) => (
          <Card key={a.id} testID={`parking-${a.id}`} className={`mb-3 ${a.isMyVehicle && a.status === 'ACTIVE' ? 'border-2 border-alert-500' : ''}`}>
            <View className="flex-row items-center">
              <View className="rounded-lg border-2 border-ink-900 bg-white px-2 py-0.5"><Text className="font-mono text-base font-extrabold tracking-wider text-ink-900">{fmtPlate(a.vehicleNumber)}</Text></View>
              <View className={`ml-auto rounded-full px-2.5 py-1 ${a.status === 'ACTIVE' ? 'bg-alert-50' : 'bg-brand-50'}`}><Text className={`text-xs font-bold ${a.status === 'ACTIVE' ? 'text-alert-700' : 'text-brand-800'}`}>{a.status === 'ACTIVE' ? 'Active' : 'Resolved'}</Text></View>
            </View>
            {a.isMyVehicle ? <Text className="mt-2 text-sm font-bold text-alert-600">⚠️ This is your vehicle</Text> : null}
            <Text className="mt-2 text-[15px] text-ink-800">{a.message}</Text>
            <Text className="mt-1 text-xs text-ink-400">{[a.location, `by ${a.reporter.name}`, timeAgo(a.createdAt), a.ownerNotified ? 'owner notified' : 'escalated to security'].filter(Boolean).join(' · ')}</Text>
            {a.status === 'ACTIVE' && (a.isMine || a.isMyVehicle) ? <Button testID={`resolve-${a.id}`} title={a.isMyVehicle ? "I've moved it" : 'Resolved'} size="sm" variant="secondary" icon="checkmark" className="mt-3 self-start" onPress={() => resolve(a)} /> : null}
          </Card>
        ))}

        <SectionTitle title="My vehicles" />
        <Card>
          {vehicles.data?.items.map((v) => (
            <View key={v.id} className="flex-row items-center border-b border-ink-100 py-2.5">
              <Icon name="car-sport" size={20} color="#0F766E" />
              <Text className="ml-2 font-mono font-bold text-ink-900">{fmtPlate(v.number)}</Text>
              <Text className="ml-2 flex-1 text-sm text-ink-500">{v.label}</Text>
              <IconButton label="Remove vehicle" name="trash-outline" color="#94A3B8" onPress={() => removeVehicle(v)} />
            </View>
          ))}
          <View className="mt-3 flex-row items-start">
            <Field testID="vehicle-number" containerClassName="mr-2 flex-1 mb-0" placeholder="KA01AB1234" autoCapitalize="characters" value={newPlate} onChangeText={setNewPlate} />
            <Field containerClassName="mr-2 w-28 mb-0" placeholder="White Swift" value={newLabel} onChangeText={setNewLabel} />
            <Button testID="add-vehicle" title="Add" disabled={newPlate.length < 6} onPress={addVehicle} />
          </View>
          <Text className="mt-2 text-xs text-ink-400">Registered vehicles get instant alerts. Your flat & number stay private.</Text>
        </Card>
      </ScrollView>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
            <Text className="text-xl font-extrabold text-ink-900">🚗 Report a vehicle</Text>
            <Text className="mb-4 mt-1 text-sm text-ink-500">We'll alert the owner directly. No phone numbers shared.</Text>
            <Field testID="parking-plate" label="Vehicle number" placeholder="KA 01 AB 1234" autoCapitalize="characters" value={plate} onChangeText={setPlate} autoFocus />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">{QUICK.map((m) => <Chip key={m} label={m.length > 28 ? 'Blocking my car' : m} selected={message === m} onPress={() => setMessage(m)} />)}</ScrollView>
            <Field label="Where?" placeholder="e.g. B2 basement, slot 45" value={location} onChangeText={setLocation} maxLength={80} />
            <Button testID="send-parking" title="Alert owner now" variant="danger" size="lg" loading={busy} disabled={plate.replace(/\W/g, '').length < 6} onPress={send} />
      </BottomSheet>
    </View>
  );
}
