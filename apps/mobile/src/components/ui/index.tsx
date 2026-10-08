import React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View, type PressableProps, type TextInputProps } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { cssInterop } from 'nativewind';
import { initials } from '@/lib/format';
import type { Level } from '@/lib/types';

cssInterop(ExpoImage, { className: 'style' });
export const Img = ExpoImage;

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 20, color = '#334155' }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

// ─────────────── Button ───────────────

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'saffron';
const VARIANT: Record<Variant, { box: string; text: string; spinner: string }> = {
  primary: { box: 'bg-brand-700 active:bg-brand-800', text: 'text-white', spinner: '#fff' },
  saffron: { box: 'bg-saffron-500 active:bg-saffron-600', text: 'text-white', spinner: '#fff' },
  secondary: { box: 'bg-brand-50 active:bg-brand-100', text: 'text-brand-800', spinner: '#0F766E' },
  outline: { box: 'border border-ink-200 bg-white active:bg-ink-50', text: 'text-ink-800', spinner: '#334155' },
  ghost: { box: 'bg-transparent active:bg-ink-100', text: 'text-ink-700', spinner: '#334155' },
  danger: { box: 'bg-alert-600 active:bg-alert-700', text: 'text-white', spinner: '#fff' },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon,
  className = '',
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  className?: string;
  testID?: string;
}) {
  const v = VARIANT[variant];
  const pad = size === 'sm' ? 'px-3 py-2' : size === 'lg' ? 'px-6 py-4' : 'px-5 py-3';
  const txt = size === 'sm' ? 'text-sm' : 'text-base';
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      className={`flex-row items-center justify-center rounded-2xl ${pad} ${v.box} ${off ? 'opacity-50' : ''} ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={v.spinner} />
      ) : (
        <>
          {icon ? (
            <View className="mr-2">
              <Icon name={icon} size={size === 'sm' ? 16 : 18} color={v.spinner} />
            </View>
          ) : null}
          <Text className={`font-semibold ${txt} ${v.text}`}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ name, onPress, color = '#0B1220', className = '', badge, label, testID }: { name: IconName; onPress?: () => void; color?: string; className?: string; badge?: number; label: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityLabel={label} accessibilityRole="button" onPress={onPress} hitSlop={8} className={`h-10 w-10 items-center justify-center rounded-full active:bg-ink-100 ${className}`}>
      <Icon name={name} size={22} color={color} />
      {badge ? (
        <View className="absolute right-0.5 top-0.5 min-w-[18px] items-center rounded-full bg-alert-600 px-1">
          <Text className="text-[10px] font-bold text-white">{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─────────────── Inputs ───────────────

export const Field = React.forwardRef<TextInput, TextInputProps & { label?: string; error?: string | null; hint?: string; prefix?: string; containerClassName?: string }>(
  function Field({ label, error, hint, prefix, containerClassName = '', className = '', multiline, ...rest }, ref) {
    return (
      <View className={`mb-4 ${containerClassName}`}>
        {label ? <Text className="mb-1.5 text-sm font-semibold text-ink-700">{label}</Text> : null}
        <View className={`flex-row items-center rounded-2xl border bg-white px-4 ${error ? 'border-alert-500' : 'border-ink-200'} ${multiline ? 'items-start py-3' : ''}`}>
          {prefix ? <Text className="mr-2 text-base font-semibold text-ink-500">{prefix}</Text> : null}
          <TextInput
            ref={ref}
            placeholderTextColor="#94A3B8"
            multiline={multiline}
            className={`flex-1 text-base text-ink-900 ${multiline ? 'min-h-[96px]' : 'h-12'} ${className}`}
            style={[multiline ? { textAlignVertical: 'top' } : null, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
            {...rest}
          />
        </View>
        {error ? <Text className="mt-1 text-xs text-alert-600">{error}</Text> : hint ? <Text className="mt-1 text-xs text-ink-500">{hint}</Text> : null}
      </View>
    );
  },
);

// ─────────────── Display ───────────────

const AVATAR_COLORS = ['#0F766E', '#B45309', '#6D28D9', '#BE185D', '#1D4ED8', '#047857', '#C2410C', '#4338CA'];
export function Avatar({ name, uri, size = 40 }: { name?: string | null; uri?: string | null; size?: number }) {
  const color = AVATAR_COLORS[(name ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  if (uri) return <Img source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} className="items-center justify-center">
      <Text style={{ fontSize: size * 0.38 }} className="font-bold text-white">
        {initials(name)}
      </Text>
    </View>
  );
}

export function LevelBadge({ level, compact }: { level: Level; compact?: boolean }) {
  if (level === 'PHONE') return compact ? null : <Pill text="Unverified" tone="neutral" />;
  const isAddr = level === 'ADDRESS';
  if (compact) return <Icon name={isAddr ? 'shield-checkmark' : 'location'} size={14} color={isAddr ? '#0F766E' : '#F5850B'} />;
  return <Pill text={isAddr ? 'Verified resident' : 'Location verified'} tone={isAddr ? 'brand' : 'saffron'} icon={isAddr ? 'shield-checkmark' : 'location'} />;
}

const TONES = {
  brand: 'bg-brand-50 text-brand-800',
  saffron: 'bg-saffron-50 text-saffron-700',
  neutral: 'bg-ink-100 text-ink-600',
  danger: 'bg-alert-50 text-alert-700',
  dark: 'bg-ink-900 text-white',
};
const TONE_ICON = { brand: '#115E59', saffron: '#B44309', neutral: '#475569', danger: '#B91C1C', dark: '#fff' };

export function Pill({ text, tone = 'neutral', icon }: { text: string; tone?: keyof typeof TONES; icon?: IconName }) {
  const [bg, fg] = TONES[tone].split(' ');
  return (
    <View className={`flex-row items-center self-start rounded-full px-2.5 py-1 ${bg}`}>
      {icon ? (
        <View className="mr-1">
          <Icon name={icon} size={12} color={TONE_ICON[tone]} />
        </View>
      ) : null}
      <Text className={`text-xs font-semibold ${fg}`}>{text}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      className={`mr-2 rounded-full border px-4 py-2 ${selected ? 'border-brand-700 bg-brand-700' : 'border-ink-200 bg-white active:bg-ink-50'}`}
    >
      <Text className={`text-sm font-semibold ${selected ? 'text-white' : 'text-ink-700'}`}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, className = '', onPress, testID }: { children: React.ReactNode; className?: string; onPress?: PressableProps['onPress']; testID?: string }) {
  // Only apply the default background when the caller didn't pass one (later CSS classes don't reliably win).
  const cls = `rounded-3xl p-4 ${/(^|\s)bg-/.test(className) ? '' : 'bg-white'} ${className}`;
  const shadow = { shadowColor: '#0B1220', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 };
  if (onPress)
    return (
      <Pressable testID={testID} onPress={onPress} className={`${cls} active:opacity-90`} style={shadow}>
        {children}
      </Pressable>
    );
  return (
    <View testID={testID} className={cls} style={shadow}>
      {children}
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View className="mb-3 mt-6 flex-row items-center justify-between">
      <Text className="text-lg font-bold text-ink-900">{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text className="text-sm font-semibold text-brand-700">{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ emoji = '🏘️', title, body, action, onAction }: { emoji?: string; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View className="items-center px-8 py-14">
      <Text className="mb-3 text-5xl">{emoji}</Text>
      <Text className="text-center text-lg font-bold text-ink-900">{title}</Text>
      {body ? <Text className="mt-2 text-center text-sm leading-5 text-ink-500">{body}</Text> : null}
      {action ? <Button title={action} onPress={onAction} className="mt-5" /> : null}
    </View>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <View className={`rounded-2xl bg-ink-100 ${className}`} />;
}

export function FeedSkeleton() {
  return (
    <View className="px-4 pt-2">
      {[0, 1, 2].map((i) => (
        <View key={i} className="mb-3 rounded-3xl bg-white p-4">
          <View className="flex-row items-center">
            <Skeleton className="h-10 w-10 rounded-full" />
            <View className="ml-3 flex-1">
              <Skeleton className="mb-2 h-3 w-32" />
              <Skeleton className="h-3 w-20" />
            </View>
          </View>
          <Skeleton className="mt-4 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-5/6" />
        </View>
      ))}
    </View>
  );
}

export function Stars({ value, size = 14, onChange }: { value: number; size?: number; onChange?: (v: number) => void }) {
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable key={i} disabled={!onChange} onPress={() => onChange?.(i)} hitSlop={4} accessibilityLabel={`${i} star`} testID={onChange ? `star-${i}` : undefined}>
          <Icon name={value >= i - 0.25 ? 'star' : value >= i - 0.75 ? 'star-half' : 'star-outline'} size={size} color="#F5850B" />
        </Pressable>
      ))}
    </View>
  );
}

export function Row({ icon, label, value, onPress, danger, testID }: { icon: IconName; label: string; value?: string; onPress?: () => void; danger?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} className="flex-row items-center border-b border-ink-100 py-4 active:bg-ink-50">
      <View className={`h-9 w-9 items-center justify-center rounded-xl ${danger ? 'bg-alert-50' : 'bg-brand-50'}`}>
        <Icon name={icon} size={18} color={danger ? '#DC2626' : '#0F766E'} />
      </View>
      <Text className={`ml-3 flex-1 text-base font-medium ${danger ? 'text-alert-600' : 'text-ink-800'}`}>{label}</Text>
      {value ? <Text className="mr-2 text-sm text-ink-500">{value}</Text> : null}
      {onPress ? <Icon name="chevron-forward" size={18} color="#94A3B8" /> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="flex-row rounded-2xl bg-ink-100 p-1">
      {options.map((o) => (
        <Pressable key={o.key} testID={`seg-${o.key}`} onPress={() => onChange(o.key)} className={`flex-1 items-center rounded-xl py-2 ${value === o.key ? 'bg-white' : ''}`}>
          <Text className={`text-sm font-semibold ${value === o.key ? 'text-ink-900' : 'text-ink-500'}`}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
