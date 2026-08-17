'use client';

import { requireState } from '@/lib/local/store';
import { importSales, recordSync } from '@/lib/local/actions';
import {
  makeRelayCall,
  relayConfigured,
  RELAY_TOKEN_KEY,
  RELAY_URL_KEY,
} from '@/lib/local/connectors/relay';
import { shopifyConnector } from '@/lib/local/connectors/shopify';
import { whopConnector } from '@/lib/local/connectors/whop';
import { ConnectorError, type Connector, type ConnectorCreds } from '@/lib/local/connectors/types';

/**
 * Connector registry and sync orchestrator.
 *
 * Adding a platform is one file plus one line in CONNECTORS. Everything else —
 * the settings UI, credential storage, dedupe, auto-sync, status reporting —
 * reads from this registry and needs no changes.
 */

export const CONNECTORS: Connector[] = [shopifyConnector, whopConnector];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** Credentials are namespaced per connector inside the encrypted database. */
export function credKey(connectorId: string, field: string): string {
  return `${connectorId}.${field}`;
}

export function credsFor(connectorId: string): ConnectorCreds {
  const all = requireState().credentials;
  const connector = getConnector(connectorId);
  if (!connector) return {};

  const out: ConnectorCreds = {};
  for (const field of connector.fields) {
    const value = all[credKey(connectorId, field.name)];
    if (value) out[field.name] = value;
  }
  return out;
}

export function isConfigured(connectorId: string): boolean {
  const connector = getConnector(connectorId);
  if (!connector) return false;

  const creds = credsFor(connectorId);
  const hasRequired = connector.fields
    .filter((f) => f.required)
    .every((f) => Boolean(creds[f.name]?.trim()));

  if (!hasRequired) return false;
  if (connector.needsRelay && !relayConfigured(requireState().credentials)) return false;

  return true;
}

function relayCall() {
  const all = requireState().credentials;
  if (!relayConfigured(all)) {
    throw new ConnectorError('Set up your relay first — Settings → Connections → Relay.', 'config');
  }
  return makeRelayCall(all[RELAY_URL_KEY], all[RELAY_TOKEN_KEY]);
}

export async function testConnector(connectorId: string): Promise<string> {
  const connector = getConnector(connectorId);
  if (!connector) throw new ConnectorError(`Unknown connector: ${connectorId}`, 'config');
  return connector.test(credsFor(connectorId), relayCall());
}

export type SyncResult = {
  ok: boolean;
  added: number;
  skipped: number;
  message: string;
};

/**
 * How far back to look when a connector has never synced. Long enough to pull
 * real history on first run, short enough not to hammer the API.
 */
const FIRST_SYNC_DAYS = 90;
/** Re-fetch a little before the last sync, since platforms can settle a payment late. */
const OVERLAP_MS = 2 * 86_400_000;

export async function syncConnector(connectorId: string): Promise<SyncResult> {
  const connector = getConnector(connectorId);
  if (!connector) {
    return { ok: false, added: 0, skipped: 0, message: `Unknown connector: ${connectorId}` };
  }

  try {
    const last = requireState().syncs[connectorId]?.at ?? 0;
    const since =
      last > 0 ? Math.max(0, last - OVERLAP_MS) : Date.now() - FIRST_SYNC_DAYS * 86_400_000;

    const outcome = await connector.fetchSales(credsFor(connectorId), since, relayCall());

    // Dedupe is by (platform, externalId), so the overlap window above can
    // never double-count — re-fetched orders are recognised and skipped.
    const { added, skipped } = importSales(outcome.sales);

    const message =
      added > 0
        ? `${added} new${skipped > 0 ? `, ${skipped} already had` : ''}.`
        : outcome.sales.length > 0
          ? 'Already up to date.'
          : 'Nothing new.';

    recordSync(connectorId, 'ok', message, added);
    return { ok: true, added, skipped, message };
  } catch (err) {
    const message =
      err instanceof ConnectorError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Sync failed.';
    recordSync(connectorId, 'error', message, 0);
    return { ok: false, added: 0, skipped: 0, message };
  }
}

/** Sync every configured connector. Used by the manual button and auto-sync. */
export async function syncAll(): Promise<Record<string, SyncResult>> {
  const results: Record<string, SyncResult> = {};

  for (const connector of CONNECTORS) {
    if (!isConfigured(connector.id)) continue;
    // Sequential on purpose: a phone on mobile data handles one at a time
    // better, and a failure in one shouldn't cancel the others.
    results[connector.id] = await syncConnector(connector.id);
  }
  return results;
}

const AUTO_SYNC_INTERVAL_MS = 30 * 60_000;

/** True when any connector is configured and hasn't synced recently. */
export function shouldAutoSync(): boolean {
  const state = requireState();
  const configured = CONNECTORS.filter((c) => isConfigured(c.id));
  if (configured.length === 0) return false;

  return configured.some((c) => {
    const last = state.syncs[c.id]?.at ?? 0;
    return Date.now() - last > AUTO_SYNC_INTERVAL_MS;
  });
}

export { RELAY_URL_KEY, RELAY_TOKEN_KEY, relayConfigured };
export type { Connector, ConnectorCreds };
