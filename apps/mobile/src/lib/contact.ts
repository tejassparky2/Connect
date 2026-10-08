import { Linking } from 'react-native';
import { toast } from './toast';

export async function call(phone: string) {
  try {
    await Linking.openURL(`tel:${phone}`);
  } catch {
    toast.info(`Call ${phone}`);
  }
}

export async function whatsapp(phone: string, text = 'Hi! I found you on Mohalla Connect.') {
  const num = phone.replace(/\D/g, '');
  try {
    await Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(text)}`);
  } catch {
    toast.info('WhatsApp is not available');
  }
}
