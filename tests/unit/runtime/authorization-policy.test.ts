import { describe, expect, it } from "@jest/globals";

import { ClaimBindingAuthorizationPolicy } from "../../../src/runtime/authorization-policy";

const ISSUER = "https://auth.example/issuer";
const ORGANIZATION_CLAIM = "https://devraftel.com/organization_id";
const FINANCE_WORKER = "finance-worker";

function policy(allowedClientIds: readonly string[] = [FINANCE_WORKER]) {
  return new ClaimBindingAuthorizationPolicy({
    issuer: ISSUER,
    organizationClaim: ORGANIZATION_CLAIM,
    allowedClientIds,
  });
}

/** A machine token: `sub` is the client id, because no human is on the badge. */
function machineClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    sub: FINANCE_WORKER,
    client_id: FINANCE_WORKER,
    [ORGANIZATION_CLAIM]: "organization-1",
    ...overrides,
  };
}

describe("ClaimBindingAuthorizationPolicy", () => {
  it("requires an issuer and an organization claim name", () => {
    expect(
      () =>
        new ClaimBindingAuthorizationPolicy({
          issuer: " ",
          organizationClaim: ORGANIZATION_CLAIM,
          allowedClientIds: [FINANCE_WORKER],
        }),
    ).toThrow();
    expect(
      () =>
        new ClaimBindingAuthorizationPolicy({
          issuer: ISSUER,
          organizationClaim: " ",
          allowedClientIds: [FINANCE_WORKER],
        }),
    ).toThrow();
  });

  describe("machine tokens", () => {
    it("accepts a token whose subject is its own client id", () => {
      const decision = policy().authorize(machineClaims());
      expect(decision).toEqual({
        allowed: true,
        identity: {
          issuer: ISSUER,
          subject: FINANCE_WORKER,
          clientId: FINANCE_WORKER,
          organizationId: "organization-1",
        },
      });
    });

    it("carries the organization the token names, not one from the request", () => {
      const decision = policy().authorize(
        machineClaims({ [ORGANIZATION_CLAIM]: "organization-2" }),
      );
      expect(decision.allowed && decision.identity.organizationId).toBe(
        "organization-2",
      );
    });

    it("reads the client identity from azp when client_id is absent", () => {
      const { client_id: _ignored, ...claims } = machineClaims();
      const decision = policy().authorize({ ...claims, azp: FINANCE_WORKER });
      expect(decision.allowed).toBe(true);
    });
  });

  describe("client allowlist", () => {
    it("refuses a client that is not on the allowlist", () => {
      const decision = policy().authorize(
        machineClaims({ sub: "other-client", client_id: "other-client" }),
      );
      expect(decision).toEqual({ allowed: false, reason: "client_not_allowed" });
    });

    it("refuses an allowlisted-looking azp when client_id is another client", () => {
      const decision = policy().authorize(
        machineClaims({ client_id: "other-client", azp: FINANCE_WORKER }),
      );
      expect(decision).toEqual({ allowed: false, reason: "client_not_allowed" });
    });

    it("accepts any of several allowlisted clients", () => {
      const decision = policy([FINANCE_WORKER, "second-worker"]).authorize(
        machineClaims({ sub: "second-worker", client_id: "second-worker" }),
      );
      expect(decision.allowed).toBe(true);
    });

    it("does not enforce an allowlist that was left empty", () => {
      // Only reachable in temporary unauthenticated mode; loadHttpConfig makes
      // an empty allowlist a startup error for every other deployment.
      const decision = policy([]).authorize(
        machineClaims({ sub: "anything", client_id: "anything" }),
      );
      expect(decision.allowed).toBe(true);
    });

    it("refuses before it looks at the organization", () => {
      const { [ORGANIZATION_CLAIM]: _ignored, ...claims } = machineClaims({
        client_id: "other-client",
      });
      expect(policy().authorize(claims)).toEqual({
        allowed: false,
        reason: "client_not_allowed",
      });
    });
  });

  describe("identity and organization", () => {
    it.each([
      ["a missing issuer", { iss: undefined }],
      ["a foreign issuer", { iss: "https://evil.example/issuer" }],
      ["a missing subject", { sub: undefined }],
      ["a blank subject", { sub: "   " }],
      ["no client identity", { client_id: undefined }],
    ])("refuses %s", (_label, overrides) => {
      expect(policy().authorize(machineClaims(overrides))).toEqual({
        allowed: false,
        reason: "missing_identity",
      });
    });

    it("refuses a missing organization claim", () => {
      const { [ORGANIZATION_CLAIM]: _ignored, ...claims } = machineClaims();
      expect(policy().authorize(claims)).toEqual({
        allowed: false,
        reason: "missing_organization",
      });
    });

    it("refuses an organization claim carrying a list", () => {
      expect(
        policy().authorize(
          machineClaims({ [ORGANIZATION_CLAIM]: ["organization-1"] }),
        ),
      ).toEqual({ allowed: false, reason: "ambiguous_organization" });
    });

    it("refuses a blank organization claim", () => {
      expect(
        policy().authorize(machineClaims({ [ORGANIZATION_CLAIM]: "  " })),
      ).toEqual({ allowed: false, reason: "missing_organization" });
    });
  });

  it("grants no authority beyond the organization it was given", () => {
    const decision = policy().authorize(
      machineClaims({
        "https://devraftel.com/agent_id": "agent-1",
        "https://devraftel.com/quickbooks_environment": "sandbox",
        "https://devraftel.com/company_id": "company-1",
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.identity).toEqual({
      issuer: ISSUER,
      subject: FINANCE_WORKER,
      clientId: FINANCE_WORKER,
      organizationId: "organization-1",
    });
  });
});
