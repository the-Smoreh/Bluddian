'use client';

import type { NewSale } from '@/lib/local/actions';

/**
 * The connector (adapter) contract.
 *
 * Adding a new platform means writing one file that satisfies this interface
 * and registering it — nothing else in the app changes. The sync orchestrator,
 * the settings screen, and the dedupe logic are all written against this shape
 * rather than against any particular platform.
 */

export type CredentialField = {
  name: string;
  label: string;
  help: string;
  required: boolean;
  /** Rendered as a password input and masked in the UI. */
  secret: boolean;
  placeholder?: string;
};

export type ConnectorCreds = Record<string, string>;

export type SyncOutcome = {
  sales: NewSale[];
  /** Human-readable summary shown in Settings. */
  message: string;
};

export type Connector = {
  id: string;
  label: string;
  blurb: string;
  /** Set when the platform can only be reached through the relay. */
  needsRelay: boolean;
  fields: CredentialField[];

  /** Cheap call proving the credentials work. Must not write anything. */
  test(creds: ConnectorCreds, call: RelayCall): Promise<string>;

  /** Pull sales since a timestamp. Returning [] is a valid, successful sync. */
  fetchSales(creds: ConnectorCreds, since: number, call: RelayCall): Promise<SyncOutcome>;
};

/**
 * The transport a connector uses. Injected rather than imported so a connector
 * never knows whether it is being relayed, called directly, or faked in a test.
 */
export type RelayCall = (req: {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; ok: boolean; json: unknown; text: string }>;

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'config' | 'upstream' = 'upstream',
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}
