import { getApiUrl, SERVER_SWITCH_ENABLED } from './config';
import { useAuth } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** First field-level validation message, if any. */
  get fieldMessage(): string {
    const d = this.details as { path: string; message: string }[] | undefined;
    return Array.isArray(d) && d[0] ? `${d[0].path ? d[0].path + ': ' : ''}${d[0].message}` : this.message;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh call (rotation would otherwise revoke the family). */
async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken, setTokens, signOut } = useAuth.getState();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${getApiUrl()}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) await signOut();
        return false;
      }
      const body = await res.json();
      await setTokens(body.accessToken, body.refreshToken);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, retry = true): Promise<T> {
  const token = useAuth.getState().accessToken;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body == null ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      SERVER_SWITCH_ENABLED
        ? `Can't reach the server at ${getApiUrl().replace(/^https?:\/\//, '')}. Check it's running, or change it under "Server" on the welcome screen.`
        : 'No internet connection. Please check your network and try again.',
    );
  }

  if (res.status === 401 && retry && useAuth.getState().refreshToken && !path.startsWith('/auth/')) {
    if (await refreshTokens()) return request<T>(method, path, body, false);
  }

  const text = await res.text();
  let json: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Proxies/CDNs return HTML on 502/504/413 — surface a friendly error, not a JSON SyntaxError.
    throw new ApiError(res.status, 'BAD_RESPONSE', res.status >= 500 ? 'Server is temporarily unavailable. Please try again.' : `Unexpected response (${res.status})`);
  }
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: async (uri: string, mime = 'image/jpeg'): Promise<string> => {
    const form = new FormData();
    if (uri.startsWith('blob:') || uri.startsWith('data:')) {
      const blob = await (await fetch(uri)).blob();
      form.append('file', blob, 'upload.jpg');
    } else {
      // React Native's FormData accepts { uri, name, type } objects.
      form.append('file', { uri, name: 'upload.jpg', type: mime } as unknown as Blob);
    }
    const r = await request<{ url: string }>('POST', '/uploads', form);
    return r.url;
  },
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};
