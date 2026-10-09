import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

export interface MockRoute {
  method: string;
  path: string | RegExp;
  status?: number;
  body: unknown | ((req: { url: string; body: unknown }) => unknown);
}

/** Replace global fetch with a tiny router; records every call for assertions. */
export function mockFetch(routes: MockRoute[]) {
  const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find((r) => r.method === method && (typeof r.path === 'string' ? url.endsWith(r.path) : r.path.test(url)));
    if (!route) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `unmocked ${method} ${url}` } }), { status: 404 });
    const payload = typeof route.body === 'function' ? (route.body as (r: { url: string; body: unknown }) => unknown)({ url, body }) : route.body;
    return new Response(JSON.stringify(payload), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}

export function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ui: <SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={qc}>{ui}</QueryClientProvider></SafeAreaProvider> };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
