import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  CallerIdentity,
} from "./contracts.js";

export type ClaimBindingPolicyOptions = {
  bindingClaim: string;
  allowedValues: readonly string[];
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function claimContains(value: unknown, allowed: ReadonlySet<string>): boolean {
  if (typeof value === "string") return allowed.has(value);
  return Array.isArray(value) && value.some((item) => typeof item === "string" && allowed.has(item));
}

/**
 * Binds a deployment to an authorization-server claim without depending on a
 * vendor-specific claim name. The claim and accepted values are deployment
 * configuration, and missing identity or binding data always fails closed.
 */
export class ClaimBindingAuthorizationPolicy implements AuthorizationPolicy {
  private readonly allowedValues: ReadonlySet<string>;

  constructor(private readonly options: ClaimBindingPolicyOptions) {
    if (!options.bindingClaim.trim() || options.allowedValues.length === 0) {
      throw new Error("Authorization binding claim and at least one allowed value are required");
    }
    this.allowedValues = new Set(options.allowedValues);
  }

  authorize(claims: Readonly<Record<string, unknown>>): AuthorizationDecision {
    const issuer = nonEmptyString(claims.iss);
    const subject = nonEmptyString(claims.sub);
    const clientId = nonEmptyString(claims.client_id) ?? nonEmptyString(claims.azp);
    if (!issuer || !subject || !clientId) return { allowed: false, reason: "missing_identity" };
    if (!claimContains(claims[this.options.bindingClaim], this.allowedValues)) {
      return { allowed: false, reason: "tenant_binding_mismatch" };
    }

    const identity: CallerIdentity = { issuer, subject, clientId, claims };
    return { allowed: true, identity };
  }
}
