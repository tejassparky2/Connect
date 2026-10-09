import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui';

const GRIEVANCE_EMAIL = process.env.EXPO_PUBLIC_GRIEVANCE_EMAIL || 'Configure EXPO_PUBLIC_GRIEVANCE_EMAIL before launch';

const SECTIONS: { title: string; body: string }[] = [
  { title: 'What we collect', body: 'Your mobile number (to log in), your name, your home address and a GPS pin of your home (to verify you live in the neighbourhood and to centre your feed), and the content you post.' },
  { title: 'What neighbours can see', body: 'Your name, photo, neighbourhood and verification badge. Never your phone number, flat number or exact location — distances are rounded and post locations are blurred to ~150 m.' },
  { title: 'What we never do', body: 'We do not collect Aadhaar, do not sell your data, and never show ads inside safety alerts or society notices.' },
  { title: 'Your rights (DPDP Act 2023)', body: 'You can correct your details in Edit profile, and delete your account at any time from Me → Delete account. Deletion erases your address, home pin, phone number and society memberships.' },
  { title: 'Grievances', body: `Grievance officer: ${GRIEVANCE_EMAIL}. We acknowledge complaints within 24 hours and resolve them within the timelines required by the IT Rules.` },
];

export default function Privacy() {
  return (
    <View className="flex-1 bg-ink-50">
      <Header title="Privacy & your data" subtitle="Plain-language summary" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {SECTIONS.map((s) => (
          <Card key={s.title} className="mb-3">
            <Text className="text-base font-bold text-ink-900">{s.title}</Text>
            <Text className="mt-1 text-sm leading-5 text-ink-600">{s.body}</Text>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}
