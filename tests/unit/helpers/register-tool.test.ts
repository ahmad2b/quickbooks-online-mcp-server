import { describe, it, expect, afterEach, jest } from "@jest/globals";
import {
  getCrudCategory,
  getToolAuthority,
  materializeToolDefinition,
  authorizeToolContext,
  isToolDisabled,
  RegisterTool,
} from "../../../src/helpers/register-tool";
import { z } from "zod";
import type { ToolDefinition } from "../../../src/types/tool-definition";
import type { RuntimeServices } from "../../../src/runtime/contracts";

function runtimeServices(): RuntimeServices {
  return {
    connectionId: "primary",
    connectionStore: {} as RuntimeServices["connectionStore"],
    rateLimiter: {} as RuntimeServices["rateLimiter"],
    authorizationPolicy: {
      authorize: jest.fn(() => ({
        allowed: true as const,
        identity: { issuer: "https://issuer", subject: "user", clientId: "client", claims: {} },
      })),
    },
    operations: {
      prepare: jest.fn(async (operation: { id: string }) => ({
        created: true,
        operationId: operation.id,
        status: "prepared" as const,
      })),
      transition: jest.fn(async () => true),
      recoverStale: jest.fn(async () => 0),
    },
    requestStateCodec: {
      mint: jest.fn(async () => "signed-state"),
      verify: jest.fn(async () => ({ operationId: "op", toolName: "create_invoice", inputHash: "hash" })),
    },
  };
}

function authContext(overrides: Record<string, unknown> = {}) {
  const claims = { iss: "https://issuer", sub: "user", client_id: "client", organization_id: "org", ...overrides };
  return {
    http: { authInfo: { scopes: ["quickbooks.read", "quickbooks.write", "quickbooks.delete"], extra: { claims } } },
    mcpReq: {
      method: "tools/call",
      requestState: () => undefined,
      inputResponses: undefined,
    },
  };
}

// ── getCrudCategory ──────────────────────────────────────────────────────────
// Verifies that every verb prefix maps to the correct CRUD category string.
// Uses literal expected values (not re-exported constants) so the test catches
// both a wrong mapping AND a wrong constant value simultaneously.
// Covers both separators used by existing tool identifiers.

describe("getCrudCategory", () => {
  it("returns WRITE for create_ prefix",  () => expect(getCrudCategory("create_invoice")).toBe("WRITE"));
  it("returns WRITE for create- prefix",  () => expect(getCrudCategory("create-bill")).toBe("WRITE"));
  it("returns UPDATE for update_ prefix", () => expect(getCrudCategory("update_customer")).toBe("UPDATE"));
  it("returns UPDATE for update- prefix", () => expect(getCrudCategory("update-vendor")).toBe("UPDATE"));
  it("returns DELETE for delete_ prefix", () => expect(getCrudCategory("delete_payment")).toBe("DELETE"));
  it("returns DELETE for delete- prefix", () => expect(getCrudCategory("delete-bill")).toBe("DELETE"));
  it("returns READ for get_ prefix",      () => expect(getCrudCategory("get_invoice")).toBe("READ"));
  it("returns READ for get- prefix",      () => expect(getCrudCategory("get-vendor")).toBe("READ"));
  it("returns READ for search_ prefix",   () => expect(getCrudCategory("search_customers")).toBe("READ"));
  it("returns READ for read_ prefix",     () => expect(getCrudCategory("read_invoice")).toBe("READ"));
});

describe("authority metadata", () => {
  it("classifies every supported authority prefix and rejects unknown names", () => {
    expect(getToolAuthority("get_invoice")).toBe("read");
    expect(getToolAuthority("read_invoice")).toBe("read");
    expect(getToolAuthority("search_invoice")).toBe("read");
    expect(getToolAuthority("create_invoice")).toBe("write");
    expect(getToolAuthority("update_invoice")).toBe("write");
    expect(getToolAuthority("delete_invoice")).toBe("delete");
    expect(getToolAuthority("unknown_invoice")).toBeUndefined();
  });

  it("materializes scope metadata and fails closed on authority errors", () => {
    const schema = z.object({ id: z.string() });
    const handler = jest.fn() as ToolDefinition<typeof schema>["handler"];
    const base = { name: "create_invoice", description: "create", schema, handler };
    expect(materializeToolDefinition(base)).toMatchObject({ authority: "write", scope: "quickbooks.write" });
    expect(() => materializeToolDefinition({ ...base, authority: "read" })).toThrow(/authority mismatch/);
    expect(() => materializeToolDefinition({ ...base, name: "unknown_invoice" })).toThrow(/no recognized authority/);
  });

  it("fails closed without HTTP context and enforces complete HTTP scopes", () => {
    const schema = z.object({ id: z.string() });
    const handler = jest.fn() as ToolDefinition<typeof schema>["handler"];
    const definition = materializeToolDefinition({ name: "delete_invoice", description: "delete", schema, handler });
    const services = runtimeServices();
    expect(authorizeToolContext(definition, undefined, services).allowed).toBe(false);
    expect(authorizeToolContext(definition, { http: { authInfo: { scopes: ["quickbooks.read"] } } }, services).allowed).toBe(false);
    expect(authorizeToolContext(definition, authContext(), services)).toEqual({ allowed: true });
  });
});

// ── isToolDisabled ───────────────────────────────────────────────────────────
// Verifies that the correct env var name gates each CRUD category.
// Uses literal env var names ("QUICKBOOKS_DISABLE_WRITE" etc.) so the test catches any
// mismatch between the documented env var and what the implementation reads.
// afterEach deletes all three vars to prevent state leaking between tests.

describe("isToolDisabled", () => {
  afterEach(() => {
    delete process.env["QUICKBOOKS_DISABLE_WRITE"];
    delete process.env["QUICKBOOKS_DISABLE_UPDATE"];
    delete process.env["QUICKBOOKS_DISABLE_DELETE"];
  });

  // READ tools must never be suppressed regardless of env state.
  it("returns false for READ tool with no env vars set", () =>
    expect(isToolDisabled("get_invoice")).toBe(false));

  it("returns false for READ tool even when all DISABLE vars are true", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true";
    process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true";
    process.env["QUICKBOOKS_DISABLE_DELETE"] = "true";
    expect(isToolDisabled("search_customers")).toBe(false);
  });

  // WRITE — underscore and hyphen variants, both enabled and disabled states.
  it("returns true for WRITE tool when QUICKBOOKS_DISABLE_WRITE=true",        () => { process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true"; expect(isToolDisabled("create_invoice")).toBe(true); });
  it("returns false for WRITE tool when QUICKBOOKS_DISABLE_WRITE unset",       () => expect(isToolDisabled("create_invoice")).toBe(false));
  it("returns true for hyphen WRITE tool when QUICKBOOKS_DISABLE_WRITE=true",  () => { process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true"; expect(isToolDisabled("create-bill")).toBe(true); });

  // UPDATE — underscore and hyphen variants, both enabled and disabled states.
  it("returns true for UPDATE tool when QUICKBOOKS_DISABLE_UPDATE=true",       () => { process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true"; expect(isToolDisabled("update_customer")).toBe(true); });
  it("returns false for UPDATE tool when QUICKBOOKS_DISABLE_UPDATE unset",      () => expect(isToolDisabled("update_customer")).toBe(false));
  it("returns true for hyphen UPDATE tool when QUICKBOOKS_DISABLE_UPDATE=true", () => { process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true"; expect(isToolDisabled("update-vendor")).toBe(true); });

  // DELETE — underscore and hyphen variants, both enabled and disabled states.
  it("returns true for DELETE tool when QUICKBOOKS_DISABLE_DELETE=true",       () => { process.env["QUICKBOOKS_DISABLE_DELETE"] = "true"; expect(isToolDisabled("delete_payment")).toBe(true); });
  it("returns false for DELETE tool when QUICKBOOKS_DISABLE_DELETE unset",      () => expect(isToolDisabled("delete_payment")).toBe(false));
  it("returns true for hyphen DELETE tool when QUICKBOOKS_DISABLE_DELETE=true", () => { process.env["QUICKBOOKS_DISABLE_DELETE"] = "true"; expect(isToolDisabled("delete-bill")).toBe(true); });

  // Boundary: only the exact string "true" disables a tool; other truthy-ish values must not.
  it('returns false when env var is "false"', () => { process.env["QUICKBOOKS_DISABLE_WRITE"] = "false"; expect(isToolDisabled("create_invoice")).toBe(false); });
  it('returns false when env var is "1"',     () => { process.env["QUICKBOOKS_DISABLE_WRITE"] = "1";     expect(isToolDisabled("create_invoice")).toBe(false); });
});

// ── RegisterTool ─────────────────────────────────────────────────────────────
// Verifies the integration between isToolDisabled and modern registerTool():
//   - Enabled tools are registered with the modern definition.
//   - Disabled tools return early without calling registerTool().
// Uses a minimal mock server object to avoid coupling to the MCP SDK internals.

describe("RegisterTool", () => {
  afterEach(() => {
    delete process.env["QUICKBOOKS_DISABLE_WRITE"];
    delete process.env["QUICKBOOKS_DISABLE_UPDATE"];
    delete process.env["QUICKBOOKS_DISABLE_DELETE"];
  });

  const schema = z.object({ id: z.string() });
  const handler = jest.fn() as ToolDefinition<typeof schema>["handler"];
  const def = (name: string): ToolDefinition<typeof schema> =>
    ({ name, description: `desc:${name}`, schema, handler });

  it("registers enabled tools through the modern API", () => {
    const server = { registerTool: jest.fn() };
    const d = def("get_invoice");
    RegisterTool(server, d);
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.registerTool).toHaveBeenCalledWith(
      d.name,
      expect.objectContaining({
        description: d.description,
        inputSchema: d.schema,
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
      expect.any(Function),
    );
  });

  // One test per mutable category to confirm the early-return path is reached.
  it("skips registerTool() for disabled WRITE tool", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"] = "true";
    const server = { registerTool: jest.fn() };
    RegisterTool(server, def("create_invoice"));
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it("skips registerTool() for disabled UPDATE tool", () => {
    process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true";
    const server = { registerTool: jest.fn() };
    RegisterTool(server, def("update_customer"));
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it("skips registerTool() for disabled DELETE tool", () => {
    process.env["QUICKBOOKS_DISABLE_DELETE"] = "true";
    const server = { registerTool: jest.fn() };
    RegisterTool(server, def("delete_payment"));
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  // READ tools must register even when all three DISABLE vars are set.
  it("registers READ tool even when all DISABLE vars are true", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true";
    process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true";
    process.env["QUICKBOOKS_DISABLE_DELETE"] = "true";
    const server = { registerTool: jest.fn() };
    RegisterTool(server, def("search_invoices"));
    expect(server.registerTool).toHaveBeenCalledTimes(1);
  });

  // Confirm the existing hyphen separator is handled by the early-return path.
  it("skips hyphen-prefixed WRITE tool when QUICKBOOKS_DISABLE_WRITE=true", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"] = "true";
    const server = { registerTool: jest.fn() };
    RegisterTool(server, def("create-bill"));
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it("registers modern direct-input callbacks with annotations and one params wrapper", async () => {
    let callback: ((input: unknown, context: unknown) => unknown) | undefined;
    const server = {
      registerTool: jest.fn((_name: string, _config: unknown, registered: typeof callback) => {
        callback = registered;
      }),
    };
    const d = def("get_invoice");
    const services = runtimeServices();
    expect(RegisterTool(server, d, services)).toBe(true);
    expect(server.registerTool).toHaveBeenCalledWith(
      d.name,
      expect.objectContaining({ annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }) }),
      expect.any(Function),
    );
    await callback?.({ id: "123" }, { http: { authInfo: { scopes: [] } } });
    expect(handler).not.toHaveBeenCalled();
    await callback?.({ id: "123" }, authContext());
    expect(handler).toHaveBeenLastCalledWith({ params: { id: "123" } }, expect.anything());
  });

  it("requires signed multi-round-trip confirmation and records mutation outcome", async () => {
    let callback: ((input: unknown, context: unknown) => Promise<any>) | undefined;
    const server = {
      registerTool: jest.fn((_name: string, _config: unknown, registered: typeof callback) => {
        callback = registered;
      }),
    };
    const services = runtimeServices();
    const mutationHandler = jest.fn(async () => ({ content: [{ type: "text", text: "created" }] }));
    RegisterTool(server, {
      name: "create_invoice",
      description: "create",
      schema,
      handler: mutationHandler,
    }, services);

    const first = await callback?.({ id: "123" }, authContext());
    expect(first.resultType).toBe("input_required");
    expect(services.operations.prepare).toHaveBeenCalledTimes(1);
    expect(mutationHandler).not.toHaveBeenCalled();

    const prepared = (services.operations.prepare as jest.Mock).mock.calls[0][0] as { id: string; inputHash: string };
    const retry = authContext() as any;
    retry.mcpReq.requestState = () => ({
      operationId: prepared.id,
      toolName: "create_invoice",
      inputHash: prepared.inputHash,
    });
    retry.mcpReq.inputResponses = {
      confirm: { action: "accept", content: { confirm: true } },
    };
    const result = await callback?.({ id: "123" }, retry);

    expect(result.content[0].text).toBe("created");
    expect(mutationHandler).toHaveBeenCalledTimes(1);
    expect(services.operations.transition).toHaveBeenLastCalledWith(
      prepared.id,
      ["executing"],
      "succeeded",
    );
  });

  it("blocks a duplicate unresolved mutation before requesting confirmation", async () => {
    let callback: ((input: unknown, context: unknown) => Promise<any>) | undefined;
    const server = {
      registerTool: jest.fn((_name: string, _config: unknown, registered: typeof callback) => {
        callback = registered;
      }),
    };
    const services = runtimeServices();
    (services.operations.prepare as any).mockResolvedValue({
      created: false,
      operationId: "existing-operation",
      status: "unknown",
    });
    const mutationHandler = jest.fn(async () => ({ content: [{ type: "text", text: "created" }] }));
    RegisterTool(server, {
      name: "create_invoice",
      description: "create",
      schema,
      handler: mutationHandler,
    }, services);

    const result = await callback?.({ id: "123" }, authContext());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("existing-operation");
    expect(mutationHandler).not.toHaveBeenCalled();
    expect(services.requestStateCodec.mint).not.toHaveBeenCalled();
  });

  it("rejects unsupported servers and honors disable policy before registration", () => {
    expect(() => RegisterTool({}, def("get_invoice"))).toThrow(/does not support/);
    process.env["QUICKBOOKS_DISABLE_WRITE"] = "true";
    const server = { registerTool: jest.fn() };
    expect(RegisterTool(server, def("create_invoice"))).toBe(false);
    expect(server.registerTool).not.toHaveBeenCalled();
  });
});
