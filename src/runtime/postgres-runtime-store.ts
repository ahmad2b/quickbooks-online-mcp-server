import crypto from "node:crypto";
import { Pool } from "pg";
import { EnvelopeEncryption } from "./envelope-encryption.js";
import type {
  OperationRecord,
  OperationRepository,
  OperationStatus,
  PrepareOperationResult,
  QuickBooksConnection,
  QuickBooksConnectionStore,
  QuickBooksTokenUpdate,
  RateLimitDecision,
  RateLimiter,
} from "./contracts.js";

type ConnectionRow = {
  id: string;
  realm_id: string;
  environment: "sandbox" | "production";
  encrypted_access_token: string | null;
  access_token_expires_at: Date | null;
  encrypted_refresh_token: string;
  refresh_token_expires_at: Date | null;
  version: number;
  status: "active" | "reauthorization_required" | "disabled";
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id text PRIMARY KEY,
  realm_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  encrypted_refresh_token text NOT NULL,
  refresh_token_expires_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reauthorization_required', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_rate_limit_buckets (
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (bucket_key, window_started_at)
);

CREATE TABLE IF NOT EXISTS mcp_operations (
  id uuid PRIMARY KEY,
  connection_id text NOT NULL REFERENCES quickbooks_connections(id),
  principal_id text NOT NULL,
  tool_name text NOT NULL,
  authority text NOT NULL CHECK (authority IN ('write', 'delete')),
  input_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared', 'executing', 'succeeded', 'failed', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_operations_principal_created_idx
  ON mcp_operations (principal_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS mcp_operations_unresolved_input_idx
  ON mcp_operations (connection_id, principal_id, tool_name, input_hash)
  WHERE status IN ('prepared', 'executing', 'unknown');
`;

function tokenContext(connectionId: string, kind: "access" | "refresh"): string {
  return `quickbooks-connection:${connectionId}:${kind}`;
}

export class PostgresRuntimeStore
implements QuickBooksConnectionStore, RateLimiter, OperationRepository {
  readonly pool: Pool;
  private readonly encryption: EnvelopeEncryption;

  constructor(databaseUrl: string, encryptionKey: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.encryption = new EnvelopeEncryption(encryptionKey);
  }

  async initialize(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private connectionFromRow(row: ConnectionRow): QuickBooksConnection {
    return {
      id: row.id,
      realmId: row.realm_id,
      environment: row.environment,
      ...(row.encrypted_access_token
        ? { accessToken: this.encryption.decrypt(row.encrypted_access_token, tokenContext(row.id, "access")) }
        : {}),
      ...(row.access_token_expires_at ? { accessTokenExpiresAt: row.access_token_expires_at } : {}),
      refreshToken: this.encryption.decrypt(row.encrypted_refresh_token, tokenContext(row.id, "refresh")),
      ...(row.refresh_token_expires_at ? { refreshTokenExpiresAt: row.refresh_token_expires_at } : {}),
      version: row.version,
      status: row.status,
    };
  }

  async load(connectionId: string): Promise<QuickBooksConnection | undefined> {
    const result = await this.pool.query<ConnectionRow>(
      "SELECT * FROM quickbooks_connections WHERE id = $1",
      [connectionId],
    );
    return result.rows[0] ? this.connectionFromRow(result.rows[0]) : undefined;
  }

  async provision(connection: Omit<QuickBooksConnection, "version" | "status">): Promise<void> {
    await this.pool.query(
      `INSERT INTO quickbooks_connections
        (id, realm_id, environment, encrypted_access_token, access_token_expires_at,
         encrypted_refresh_token, refresh_token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        connection.id,
        connection.realmId,
        connection.environment,
        connection.accessToken
          ? this.encryption.encrypt(connection.accessToken, tokenContext(connection.id, "access"))
          : null,
        connection.accessTokenExpiresAt ?? null,
        this.encryption.encrypt(connection.refreshToken, tokenContext(connection.id, "refresh")),
        connection.refreshTokenExpiresAt ?? null,
      ],
    );
  }

  async withRefreshLock<T>(
    connectionId: string,
    callback: (
      current: QuickBooksConnection,
      persist: (tokens: QuickBooksTokenUpdate) => Promise<QuickBooksConnection>,
    ) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [connectionId]);
      const selected = await client.query<ConnectionRow>(
        "SELECT * FROM quickbooks_connections WHERE id = $1 FOR UPDATE",
        [connectionId],
      );
      if (!selected.rows[0]) throw new Error("QuickBooks connection is not provisioned");
      const current = this.connectionFromRow(selected.rows[0]);
      if (current.status !== "active") throw new Error(`QuickBooks connection is ${current.status}`);

      const persist = async (tokens: QuickBooksTokenUpdate): Promise<QuickBooksConnection> => {
        const updated = await client.query<ConnectionRow>(
          `UPDATE quickbooks_connections
             SET encrypted_access_token = $2,
                 access_token_expires_at = $3,
                 encrypted_refresh_token = $4,
                 refresh_token_expires_at = $5,
                 version = version + 1,
                 status = 'active',
                 updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [
            connectionId,
            this.encryption.encrypt(tokens.accessToken, tokenContext(connectionId, "access")),
            tokens.accessTokenExpiresAt,
            this.encryption.encrypt(tokens.refreshToken, tokenContext(connectionId, "refresh")),
            tokens.refreshTokenExpiresAt ?? null,
          ],
        );
        if (!updated.rows[0]) throw new Error("QuickBooks token persistence failed");
        return this.connectionFromRow(updated.rows[0]);
      };

      const result = await callback(current, persist);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markReauthorizationRequired(connectionId: string): Promise<void> {
    await this.pool.query(
      "UPDATE quickbooks_connections SET status = 'reauthorization_required', updated_at = now() WHERE id = $1",
      [connectionId],
    );
  }

  async consume(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitDecision> {
    const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM mcp_rate_limit_buckets WHERE bucket_key = $1 AND window_started_at < $2",
        [key, windowStartedAt],
      );
      const result = await client.query<{ request_count: number }>(
        `INSERT INTO mcp_rate_limit_buckets (bucket_key, window_started_at, request_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (bucket_key, window_started_at)
         DO UPDATE SET request_count = mcp_rate_limit_buckets.request_count + 1
         RETURNING request_count`,
        [key, windowStartedAt],
      );
      await client.query("COMMIT");
      const count = result.rows[0]?.request_count ?? limit + 1;
      return {
        allowed: count <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt.getTime() + windowMs - now) / 1000)),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async prepare(operation: OperationRecord): Promise<PrepareOperationResult> {
    const inserted = await this.pool.query<{ id: string; status: OperationStatus }>(
      `INSERT INTO mcp_operations
        (id, connection_id, principal_id, tool_name, authority, input_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (connection_id, principal_id, tool_name, input_hash)
         WHERE status IN ('prepared', 'executing', 'unknown')
       DO NOTHING
       RETURNING id, status`,
      [
        operation.id,
        operation.connectionId,
        operation.principalId,
        operation.toolName,
        operation.authority,
        operation.inputHash,
        operation.status,
      ],
    );
    if (inserted.rows[0]) {
      return { created: true, operationId: inserted.rows[0].id, status: inserted.rows[0].status };
    }

    const existing = await this.pool.query<{ id: string; status: OperationStatus }>(
      `SELECT id, status
         FROM mcp_operations
        WHERE connection_id = $1
          AND principal_id = $2
          AND tool_name = $3
          AND input_hash = $4
          AND status IN ('prepared', 'executing', 'unknown')
        ORDER BY created_at DESC
        LIMIT 1`,
      [operation.connectionId, operation.principalId, operation.toolName, operation.inputHash],
    );
    if (!existing.rows[0]) throw new Error("Operation preparation conflict could not be resolved");
    return { created: false, operationId: existing.rows[0].id, status: existing.rows[0].status };
  }

  async transition(id: string, from: readonly OperationStatus[], to: OperationStatus): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mcp_operations
          SET status = $3, updated_at = now()
        WHERE id = $1 AND status = ANY($2::text[])`,
      [id, from, to],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async recoverStale(preparedMaxAgeMs: number, executingMaxAgeMs: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE mcp_operations
          SET status = CASE WHEN status = 'prepared' THEN 'failed' ELSE 'unknown' END,
              updated_at = now()
        WHERE (status = 'prepared'
               AND updated_at < now() - ($1::double precision * interval '1 millisecond'))
           OR (status = 'executing'
               AND updated_at < now() - ($2::double precision * interval '1 millisecond'))`,
      [preparedMaxAgeMs, executingMaxAgeMs],
    );
    return result.rowCount ?? 0;
  }

  static principalHash(issuer: string, subject: string, clientId: string): string {
    return crypto.createHash("sha256").update(`${issuer}\0${subject}\0${clientId}`).digest("hex");
  }
}
