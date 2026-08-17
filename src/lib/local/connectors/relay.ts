'use client';

import { ConnectorError, type RelayCall } from '@/lib/local/connectors/types';

/**
 * Builds the transport that connectors use.
 *
 * Every upstream request is wrapped in one POST to your relay, which forwards
 * it and adds the CORS header the browser insists on. The relay URL and token
 * live in the encrypted database like any other credential.
 */

export const RELAY_URL_KEY = 'relay.url';
export const RELAY_TOKEN_KEY = 'relay.token';

const TIMEOUT_MS = 30_000;

export function relayConfigured(creds: Record<string, string>): boolean {
  return Boolean(creds[RELAY_URL_KEY]?.trim() && creds[RELAY_TOKEN_KEY]?.trim());
}

export function makeRelayCall(relayUrl: string, relayToken: string): RelayCall {
  const endpoint = relayUrl.trim().replace(/\/+$/, '');

  // HTTPS is required because your API keys travel through this URL. The one
  // exception is localhost, which never leaves the machine and is how the
  // relay gets tested against a local mock.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(endpoint);
  if (!/^https:\/\//i.test(endpoint) && !isLocal) {
    throw new ConnectorError(
      'Relay URL must start with https:// — your API keys travel through it.',
      'config',
    );
  }

  return async ({ url, method = 'GET', headers = {}, body }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Relay-Token': relayToken,
        },
        body: JSON.stringify({ url, method, headers, body }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new ConnectorError('The relay took too long to answer.', 'network');
      }
      // A failure here is the relay itself being unreachable, not the platform.
      throw new ConnectorError(
        'Could not reach your relay. Check the URL is right and the Worker is deployed.',
        'network',
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: { status?: number; ok?: boolean; body?: string; error?: string };
    try {
      payload = await response.json();
    } catch {
      throw new ConnectorError('The relay returned something that was not JSON.', 'network');
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new ConnectorError('Relay rejected the token. Check RELAY_TOKEN matches.', 'auth');
      }
      throw new ConnectorError(payload.error ?? `Relay error ${response.status}.`, 'network');
    }

    const text = payload.body ?? '';
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* upstream returned non-JSON; connectors that care can read `text` */
    }

    return {
      status: payload.status ?? 0,
      ok: Boolean(payload.ok),
      json: parsed,
      text,
    };
  };
}

/** Confirms the relay is alive and the token matches, without touching a platform. */
export async function testRelay(relayUrl: string, relayToken: string): Promise<string> {
  const call = makeRelayCall(relayUrl, relayToken);

  // Any allowlisted host works as a probe; an unauthenticated Whop call returns
  // a clean 401 from Whop, which still proves the whole path works.
  const res = await call({ url: 'https://api.whop.com/api/v5/company/products?per=1' });

  if (res.status === 0) {
    throw new ConnectorError('Relay answered but did not reach the upstream.', 'network');
  }
  return `Relay is working (upstream replied ${res.status}).`;
}
