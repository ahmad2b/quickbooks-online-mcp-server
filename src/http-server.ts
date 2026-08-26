import crypto from "node:crypto";
import http from "node:http";
import type { Express, NextFunction, Request, Response } from "express";
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  isJsonContentType,
  OAuthError,
  OAuthErrorCode,
  type McpHttpHandler,
  type McpServerFactory,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  scopeForAuthority,
  hasForbiddenExecutionField,
  FORBIDDEN_EXECUTION_INPUT_MESSAGE,
} from "./helpers/register-tool.js";
import {
  loadHttpConfig,
  MCP_PATH,
  QUICKBOOKS_SCOPES,
  type HttpConfig,
} from "./http-config.js";
import { loadOAuthMetadata } from "./auth/oauth-metadata.js";
import { OAuthAccessTokenVerifier } from "./auth/oauth-access-token-verifier.js";
import type { ToolAuthority } from "./types/tool-definition.js";
import { APPLICATION_VERSION } from "./version.js";
import type { RuntimeServices } from "./runtime/contracts.js";
import { createProductionRuntime, type RuntimeProviderAdapters } from "./runtime/production-runtime.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const WINDOW_MS = 60_000;

type RequestBody = {
  id?: unknown;
  method?: unknown;
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
};

type RequestLog = {
  event: "mcp_request";
  requestId: string;
  traceparent?: string;
  method: string;
  tool?: string;
  status: number;
  durationMs: number;
  principal: string;
};

export type HttpServerLogger = (record: RequestLog) => void;

export type HttpAppOptions = {
  config: HttpConfig;
  oauthMetadata: OAuthMetadata;
  tokenVerifier?: OAuthTokenVerifier;
  serverFactory?: McpServerFactory;
  logger?: HttpServerLogger;
  version?: string;
  now?: () => number;
  shutdownTimeoutMs?: number;
  /** Resolver backed by the executable registry; absent means fail closed. */
  toolAuthority?: (name: string) => ToolAuthority | undefined;
  services: RuntimeServices;
};

export type HttpApp = {
  app: Express;
  handler: McpHttpHandler;
  config: HttpConfig;
  setReady: (ready: boolean) => void;
  beginShutdown: () => void;
  closeHandler: () => Promise<void>;
};

export type HttpServerHandle = HttpApp & {
  server: http.Server;
  close: () => Promise<void>;
};

function stableIdentifier(value: string | undefined): string {
  if (!value) return "anonymous";
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function requestId(req: Request): { id: string; traceparent?: string } {
  const incoming = req.get("traceparent");
  // Preserve valid W3C trace context for correlation, but never echo arbitrary
  // header contents into logs or response headers.
  if (incoming && /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(incoming)) {
    return { id: incoming, traceparent: incoming };
  }
  return { id: crypto.randomUUID() };
}

function bodyOf(req: Request): RequestBody {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as RequestBody
    : {};
}

function bodyMethod(req: Request): string | undefined {
  const method = bodyOf(req).method;
  return typeof method === "string" ? method : undefined;
}

function bodyTool(req: Request): string | undefined {
  const name = bodyOf(req).params?.name;
  return typeof name === "string" ? name : undefined;
}

function headerBodyValuesMatch(req: Request): boolean {
  const method = bodyMethod(req);
  const headerMethod = req.get("Mcp-Method");
  if (!method || !headerMethod || method !== headerMethod) return false;
  if (method !== "tools/call") return true;
  const name = bodyTool(req);
  const headerName = req.get("Mcp-Name");
  return Boolean(name && headerName && name === headerName);
}

function authorityForRegisteredTool(
  resolver: ((name: string) => ToolAuthority | undefined) | undefined,
  name: string | undefined,
): ToolAuthority | undefined {
  return resolver && name ? resolver(name) : undefined;
}

function requiredScopes(
  req: Request,
  resolver: ((name: string) => ToolAuthority | undefined) | undefined,
): string[] | undefined {
  const method = bodyMethod(req);
  if (method !== "tools/call") return ["quickbooks.read"];
  const authority = authorityForRegisteredTool(resolver, bodyTool(req));
  if (!authority) return undefined;
  return ["quickbooks.read", scopeForAuthority(authority)];
}

function authorityClass(
  req: Request,
  resolver: ((name: string) => ToolAuthority | undefined) | undefined,
): string {
  // Header/body agreement is the validation boundary. A malformed or
  // mismatched request gets one neutral rate bucket and never selects a
  // privilege class from attacker-controlled text.
  if (!headerBodyValuesMatch(req)) return "invalid";
  const method = bodyMethod(req);
  if (method !== "tools/call") return "read";
  return authorityForRegisteredTool(resolver, bodyTool(req)) ?? "unknown";
}

function logToStderr(record: RequestLog): void {
  // JSON.stringify is deliberately limited to fields assembled above. Never
  // include req.body, Authorization, MCP headers, or handler output.
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

function sendJson(res: Response, status: number, body: Record<string, unknown>): void {
  if (!res.headersSent) res.status(status).type("application/json").send(JSON.stringify(body));
}

function sendJsonRpcError(
  req: Request,
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  const id = bodyOf(req).id;
  sendJson(res, status, {
    jsonrpc: "2.0",
    id: typeof id === "string" || typeof id === "number" ? id : null,
    error: { code, message },
  });
}

function sendInBandToolError(
  req: Request,
  res: Response,
  code: string,
  message: string,
): void {
  const id = bodyOf(req).id;
  sendJson(res, 200, {
    jsonrpc: "2.0",
    id: typeof id === "string" || typeof id === "number" ? id : null,
    result: {
      isError: true,
      resultType: "complete",
      content: [{ type: "text", text: message }],
      _meta: { errorCode: code },
    },
  });
}

async function sendFetchResponse(res: Response, response: globalThis.Response): Promise<void> {
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = await response.text();
  if (!res.headersSent) res.status(response.status).send(body);
}

function makeScopeMiddleware(
  config: HttpConfig,
  resolver: ((name: string) => ToolAuthority | undefined) | undefined,
) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUri);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // The official SDK remains the execution authority for header/body
    // consistency. Do not use an unvalidated name to choose a privilege.
    if (!headerBodyValuesMatch(req)) {
      next();
      return;
    }

    const authInfo = req.auth;
    const needed = requiredScopes(req, resolver);
    if (!needed) {
      // tools/call is a known RPC method. Let the MCP SDK return its canonical
      // -32602 InvalidParams response for an unknown tool name.
      next();
      return;
    }
    if (authInfo && needed.every((scope) => authInfo.scopes.includes(scope))) {
      next();
      return;
    }

    const error = new OAuthError(
      OAuthErrorCode.InsufficientScope,
      "Insufficient scope for this MCP operation",
    );
    await sendFetchResponse(
      res,
      bearerAuthChallengeResponse(error, {
        requiredScopes: needed,
        resourceMetadataUrl,
      }),
    );
  };
}

function makeRateLimitMiddleware(
  config: HttpConfig,
  now: () => number,
  resolver: ((name: string) => ToolAuthority | undefined) | undefined,
  services: RuntimeServices,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authInfo = req.auth;
    if (!authInfo) {
      next();
      return;
    }

    try {
      const claims = authInfo.extra?.claims;
      const claimRecord = claims && typeof claims === "object" && !Array.isArray(claims)
        ? claims as Record<string, unknown>
        : {};
      const identity = services.authorizationPolicy.authorize(claimRecord);
      if (!identity.allowed) {
        sendJsonRpcError(req, res, 403, -32001, "The caller is not authorized for this resource");
        return;
      }
      const identityKey = [
        identity.identity.issuer,
        identity.identity.subject,
        identity.identity.clientId,
        identity.identity.organizationId,
        identity.identity.qboConnectionId,
      ]
        .map((value) => stableIdentifier(typeof value === "string" ? value : undefined))
        .join(":");
      const key = `${identityKey}:${authorityClass(req, resolver)}`;
      const decision = await services.rateLimiter.consume(
        key,
        config.rateLimitPerMinute,
        WINDOW_MS,
        now(),
      );
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        sendJsonRpcError(req, res, 429, -32000, "Too many requests");
        return;
      }
      next();
    } catch {
      sendJsonRpcError(req, res, 503, -32603, "Rate-limit service unavailable");
    }
  };
}

function makeCompanyBindingMiddleware(config: HttpConfig, services: RuntimeServices) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUri);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authInfo = req.auth;
    // OAuthTokenVerifier implementations should enforce audience/resource
    // binding themselves. Re-check the resulting AuthInfo here so an injected
    // verifier cannot accidentally authorize a token minted for another API.
    if (!authInfo?.resource || !(authInfo.resource instanceof URL) ||
        authInfo.resource.href !== config.resourceUri.href) {
      await sendFetchResponse(
        res,
        bearerAuthChallengeResponse(
          new OAuthError(OAuthErrorCode.InvalidToken, "The access token is not issued for this resource"),
          { resourceMetadataUrl },
        ),
      );
      return;
    }
    const claims = req.auth?.extra?.claims;
    const decision = services.authorizationPolicy.authorize(
      claims && typeof claims === "object" && !Array.isArray(claims)
        ? claims as Record<string, unknown>
        : {},
    );
    if (!decision.allowed) {
      sendJsonRpcError(req, res, 403, -32001, "The caller is not authorized for this resource");
      return;
    }
    next();
  };
}

/**
 * Reject execution-routing fields before the MCP SDK validates tool input.
 * Zod object schemas intentionally strip unknown keys, so a callback-level
 * check cannot see a forged tenant, connection, realm, or credential field.
 */
export function makeExecutionInputMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (bodyMethod(req) === "tools/call" && hasForbiddenExecutionField(bodyOf(req).params?.arguments)) {
      sendInBandToolError(
        req,
        res,
        "MCP_TOOL_NOT_AUTHORIZED",
        FORBIDDEN_EXECUTION_INPUT_MESSAGE,
      );
      return;
    }
    next();
  };
}

/**
 * SDK 2.0.0 treats MCP-Protocol-Version as an optional cross-check, while the
 * 2026-07-28 Streamable HTTP specification requires it on every POST. Enforce
 * only presence here; the SDK remains responsible for value support and
 * header/body agreement so its canonical -32022/-32020 payloads are preserved.
 */
function makeRequiredProtocolVersionHeader(req: Request, res: Response, next: NextFunction): void {
  // Let the SDK's Content-Type check take precedence when the body is not JSON.
  if (req.method === "POST" &&
      isJsonContentType(req.get("content-type")) &&
      !req.get("MCP-Protocol-Version")) {
    sendJsonRpcError(
      req,
      res,
      400,
      -32020,
      "Header mismatch: required MCP-Protocol-Version header is missing",
    );
    return;
  }
  next();
}

function makeRequestLogger(
  logger: HttpServerLogger,
  now: () => number,
  resolver: ((name: string) => ToolAuthority | undefined) | undefined,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = now();
    const ids = requestId(req);
    res.setHeader("X-Request-Id", ids.id);
    res.once("finish", () => {
      const body = bodyOf(req);
      const method = typeof body.method === "string"
        ? body.method
        : req.get("Mcp-Method") ?? "unknown";
      const candidateTool = typeof body.params?.name === "string" &&
        authorityForRegisteredTool(resolver, body.params.name)
        ? body.params.name
        : undefined;
      logger({
        event: "mcp_request",
        requestId: ids.id,
        ...(ids.traceparent ? { traceparent: ids.traceparent } : {}),
        method,
        ...(candidateTool ? { tool: candidateTool } : {}),
        status: res.statusCode,
        durationMs: Math.max(0, now() - startedAt),
        principal: stableIdentifier(req.auth?.clientId),
      });
    });
    next();
  };
}

function defaultServerFactory(services: RuntimeServices): McpServerFactory {
  return () => import("./server/qbo-mcp-server.js")
    .then(({ createQuickbooksMcpServer }) => createQuickbooksMcpServer(services));
}

/**
 * Compose the in-process HTTP boundary. Production startup supplies a
 * validated config, RFC 8414 metadata, and a token verifier before binding a
 * listener; tests can inject all three without network or QuickBooks access.
 */
export function createHttpApp(options: HttpAppOptions): HttpApp {
  // Keep the invariant on the HTTP boundary itself as well as startup: a
  // caller that composes the in-process app directly must never fall back to
  // Intuit's interactive localhost OAuth flow.
  process.env.QUICKBOOKS_NON_INTERACTIVE = "true";
  const now = options.now ?? Date.now;
  const logger = options.logger ?? logToStderr;
  const version = options.version ?? process.env.APP_VERSION ?? APPLICATION_VERSION;
  const state = { ready: false, draining: false, inFlight: 0 };
  const tokenVerifier = options.tokenVerifier ?? new OAuthAccessTokenVerifier({
    issuer: options.config.authIssuer,
    resourceUri: options.config.resourceUri.toString(),
    jwksUrl: options.config.authJwksUrl?.toString(),
    introspectionUrl: options.config.authIntrospectionUrl?.toString(),
    introspectionClientId: options.config.authIntrospectionClientId,
    introspectionClientSecret: options.config.authIntrospectionClientSecret,
  });
  const handler = createMcpHandler(
    options.serverFactory ?? defaultServerFactory(options.services),
    {
      legacy: "reject",
      responseMode: "json",
      keepAliveMs: 0,
      onerror: (error) => {
        // Keep protocol errors out of the response log while retaining a
        // useful, redacted stderr signal for operators.
        process.stderr.write(`{"event":"mcp_handler_error","type":"${error.name}"}\n`);
      },
    },
  );
  const app = createMcpExpressApp({
    host: options.config.listenHost,
    allowedHosts: options.config.allowedHosts,
    allowedOrigins: options.config.allowedOrigins,
    jsonLimit: options.config.bodyLimit,
  });
  const toolAuthority = options.toolAuthority;

  app.use(mcpAuthMetadataRouter({
    oauthMetadata: options.oauthMetadata,
    resourceServerUrl: options.config.resourceUri,
    scopesSupported: [...QUICKBOOKS_SCOPES],
    resourceName: "QuickBooks Online MCP Server",
  }));

  const health = (_req: Request, res: Response): void => {
    const ready = state.ready && !state.draining;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "not_ready",
      version,
      ready,
    });
  };
  app.get("/livez", (_req: Request, res: Response) => res.status(200).json({ status: "ok", version }));
  app.get("/readyz", health);
  app.get("/healthz", health);

  const bearer = requireBearerAuth({
    verifier: tokenVerifier,
    requiredScopes: ["quickbooks.read"],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(options.config.resourceUri),
  });
  const scope = makeScopeMiddleware(options.config, toolAuthority);
  const companyBinding = makeCompanyBindingMiddleware(options.config, options.services);
  const executionInput = makeExecutionInputMiddleware();
  const rateLimit = makeRateLimitMiddleware(options.config, now, toolAuthority, options.services);
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => {
      process.stderr.write(`{"event":"mcp_node_handler_error","type":"${error.name}"}\n`);
    },
  });

  app.all(MCP_PATH, makeRequestLogger(logger, now, toolAuthority), makeRequiredProtocolVersionHeader, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    if (state.draining) {
      sendJsonRpcError(req, res, 503, -32603, "Server is shutting down");
      return;
    }
    state.inFlight += 1;
    // Application-enforced cancellation is safe for reads. It is deliberately
    // not applied after dispatching a financial mutation: terminating the HTTP
    // request cannot cancel a QuickBooks commit and would create a false retry
    // signal. Mutation outcomes are instead recorded in the durable ledger.
    const readRequest = authorityClass(req, toolAuthority) === "read";
    const timeout = readRequest
      ? setTimeout(() => {
          if (!res.headersSent) sendJsonRpcError(req, res, 408, -32000, "Request timed out");
          req.destroy();
        }, options.config.requestTimeoutMs)
      : undefined;
    timeout?.unref();
    res.once("finish", () => {
      if (timeout) clearTimeout(timeout);
      state.inFlight = Math.max(0, state.inFlight - 1);
    });
    next();
  }, bearer, companyBinding, executionInput, rateLimit, scope, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await nodeHandler(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });

  // Express's default parser error is an HTML response. Keep framing errors
  // machine-readable and do not echo parser details or request contents.
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const errorStatus = error && typeof error === "object" && "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    const status = errorStatus === 413 ? 413 : errorStatus === 400 ? 400 : 500;
    if (status === 400) {
      sendJsonRpcError(req, res, status, -32700, "Parse error: the request body is not valid JSON");
      return;
    }
    if (status === 413) {
      sendJsonRpcError(req, res, status, -32600, "Invalid Request: request body exceeds configured limit");
      return;
    }
    sendJsonRpcError(req, res, status, -32603, "Internal server error");
  });
  app.use((_req: Request, res: Response) => sendJson(res, 404, { error: "not_found" }));

  return {
    app,
    handler,
    config: options.config,
    setReady: (ready) => { state.ready = ready; },
    beginShutdown: () => { state.draining = true; },
    closeHandler: () => handler.close(),
  };
}

/**
 * Validate configuration, fetch authorization-server metadata, verify injected
 * provider readiness, and only then bind the HTTP listener. HTTP mode sets the
 * non-interactive marker before any QuickBooks request can be dispatched.
 */
export async function startHttpServer(
  options: Partial<Omit<HttpAppOptions, "config" | "oauthMetadata" | "tokenVerifier" | "services">> & {
    config?: HttpConfig;
    oauthMetadata?: OAuthMetadata;
    tokenVerifier?: OAuthTokenVerifier;
    fetchImpl?: typeof fetch;
    services?: RuntimeServices;
    runtimeAdapters?: RuntimeProviderAdapters;
  } = {},
): Promise<HttpServerHandle> {
  process.env.QUICKBOOKS_NON_INTERACTIVE = "true";
  const config = options.config ?? loadHttpConfig();
  const oauthMetadata = options.oauthMetadata ?? await loadOAuthMetadata(config, {
    fetchImpl: options.fetchImpl,
  });
  const tokenVerifier = options.tokenVerifier ?? new OAuthAccessTokenVerifier({
    issuer: config.authIssuer,
    resourceUri: config.resourceUri.toString(),
    jwksUrl: config.authJwksUrl?.toString(),
    introspectionUrl: config.authIntrospectionUrl?.toString(),
    introspectionClientId: config.authIntrospectionClientId,
    introspectionClientSecret: config.authIntrospectionClientSecret,
    fetchImpl: options.fetchImpl,
  });

  // Runtime composition performs provider readiness checks without acquiring a
  // customer lease. No QuickBooks credential is loaded during cold start.
  const ownedRuntime = options.services ? undefined : await createProductionRuntime(config, options.runtimeAdapters);
  const services = options.services ?? ownedRuntime!.services;

  let appState: HttpApp;
  try {
    let serverFactory = options.serverFactory;
    let toolAuthority = options.toolAuthority;
    if (!serverFactory) {
      // Import the QuickBooks registry only after configuration, OAuth metadata,
      // and durable-state validation have succeeded.
      const registry = await import("./registry.js");
      if (!toolAuthority) {
        const authorityByName = new Map(
          registry.TOOL_DEFINITIONS.map((definition) => [definition.name, definition.authority]),
        );
        toolAuthority = (name: string) => authorityByName.get(name);
      }
      const { createQuickbooksMcpServer } = await import("./server/qbo-mcp-server.js");
      serverFactory = () => createQuickbooksMcpServer(services);
    }
    appState = createHttpApp({
      ...options,
      config,
      oauthMetadata,
      tokenVerifier,
      services,
      serverFactory: serverFactory!,
      toolAuthority,
    });
  } catch (error) {
    await ownedRuntime?.close().catch(() => undefined);
    throw error;
  }
  const server = http.createServer(appState.app);
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    appState.beginShutdown();
    const shutdownDeadline = Date.now() + shutdownTimeoutMs;
    const remainingShutdownMs = () => Math.max(0, shutdownDeadline - Date.now());
    await new Promise<void>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        server.closeAllConnections();
        finish();
      }, remainingShutdownMs());
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      server.close(finish);
      server.closeIdleConnections();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, remainingShutdownMs());
        appState.closeHandler().then(
          () => { clearTimeout(timeout); resolve(); },
          (error) => { clearTimeout(timeout); reject(error); },
        );
      });
    } finally {
      try {
        await ownedRuntime?.close();
      } finally {
        process.removeListener("SIGINT", shutdown);
        process.removeListener("SIGTERM", shutdown);
      }
    }
  };
  const shutdown = () => {
    void close().catch((error: unknown) => {
      process.stderr.write(`{"event":"mcp_shutdown_error","type":"${error instanceof Error ? error.name : "unknown"}"}\n`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        appState.setReady(true);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.listenPort, config.listenHost);
    });
  } catch (error) {
    try {
      await appState.closeHandler();
    } finally {
      try {
        await ownedRuntime?.close();
      } finally {
        process.removeListener("SIGINT", shutdown);
        process.removeListener("SIGTERM", shutdown);
      }
    }
    throw error;
  }

  return { ...appState, server, close };
}
