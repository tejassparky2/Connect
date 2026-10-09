import * as SecureStore from 'expo-secure-store';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  await useAuth.getState().signIn('old-access', 'old-refresh', { id: 'u1' } as never);
});

test('concurrent 401s trigger exactly ONE refresh, then both requests retry with the new token', async () => {
  let refreshCalls = 0;
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/refresh')) {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return json(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
    }
    const auth = (init?.headers as Record<string, string>).Authorization;
    return auth === 'Bearer new-access' ? json(200, { ok: url }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } });
  }) as unknown as typeof fetch;

  const [a, b] = await Promise.all([api.get<{ ok: string }>('/me'), api.get<{ ok: string }>('/feed')]);
  expect(a.ok).toMatch(/\/v1\/me$/);
  expect(b.ok).toMatch(/\/v1\/feed$/);
  expect(refreshCalls).toBe(1);
  expect(useAuth.getState().accessToken).toBe('new-access');
  expect(await SecureStore.getItemAsync('mc.refresh')).toBe('new-refresh');
});

test('a rejected refresh signs the user out and clears secure storage', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/auth/refresh') ? json(401, { error: { code: 'UNAUTHORIZED', message: 'reuse detected' } }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }),
  ) as unknown as typeof fetch;
  await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
  expect(useAuth.getState().status).toBe('signedOut');
  expect(await SecureStore.getItemAsync('mc.refresh')).toBeNull();
});

test('network failures become a friendly ApiError; validation details surface the field', async () => {
  global.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  await expect(api.get('/feed')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });

  global.fetch = jest.fn(async () => json(400, { error: { code: 'BAD_REQUEST', message: 'Validation failed', details: [{ path: 'pincode', message: 'Enter a valid 6-digit PIN code' }] } })) as unknown as typeof fetch;
  const err = await api.put('/me/address', {}).catch((e) => e as ApiError);
  expect(err.fieldMessage).toBe('pincode: Enter a valid 6-digit PIN code');
});

test('React Native upload uses the {uri,name,type} FormData part and no JSON content-type', async () => {
  let sent: RequestInit | undefined;
  global.fetch = jest.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    sent = init;
    return json(201, { url: 'https://cdn/x.jpg' });
  }) as unknown as typeof fetch;
  const url = await api.upload('file:///data/photo.jpg', 'image/jpeg');
  expect(url).toBe('https://cdn/x.jpg');
  expect(sent?.body).toBeInstanceOf(FormData);
  expect((sent?.headers as Record<string, string>)['Content-Type']).toBeUndefined(); // boundary must be set by RN
});
