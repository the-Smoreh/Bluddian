'use client';

/**
 * Browser-side API client.
 *
 * Every mutating call must carry the CSRF token that the server set as a
 * readable cookie at login. Centralising that here means no route can be
 * called from the UI without it — a route that forgets the header simply
 * doesn't exist as far as the app is concerned.
 */

export const CSRF_HEADER = 'x-bluddian-csrf';

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)bl_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';

  const res = await fetch(path, {
    method,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { [CSRF_HEADER]: csrfToken() } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    signal: options.signal,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const data = payload as { error?: string; retryAfter?: number } | null;
    // A 401 mid-session means the cookie expired; bounce to login rather than
    // showing a confusing error on every subsequent action.
    if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/')) {
      window.location.href = '/login';
    }
    throw new ApiError(
      data?.error ?? `Request failed (${res.status})`,
      res.status,
      data?.retryAfter,
    );
  }

  return payload as T;
}

/** Convenience helpers so call sites read as intent, not HTTP. */
export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
