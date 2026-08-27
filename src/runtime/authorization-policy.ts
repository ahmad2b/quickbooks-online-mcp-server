import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  CallerIdentity,
} from "./contracts.js";

export type ClaimBindingPolicyOptions = {
  issuer: string;
  organizationClaim: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Return one claim value only. Arrays are intentionally rejected, even when
 * they contain one item: an MCP access token represents exactly one
 * organization.
 */
function singleClaimValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Extracts the caller and organization binding without coupling the resource
 * server to an authorization-vendor claim name. The connection service remains
 * the authority for resolving a QuickBooks connection after this decision.
 */
export class ClaimBindingAuthorizationPolicy implements AuthorizationPolicy {
  constructor(private readonly options: ClaimBindingPolicyOptions) {
    if (!options.issuer.trim() || !options.organizationClaim.trim()) {
      throw new Error("Issuer and organization claim names are required");
    }
  }

  authorize(claims: Readonly<Record<string, unknown>>): AuthorizationDecision {
    const issuer = nonEmptyString(claims.iss);
    const subject = nonEmptyString(claims.sub);
    const clientId = nonEmptyString(claims.client_id) ?? nonEmptyString(claims.azp);
    if (!issuer || !subject || !clientId) return { allowed: false, reason: "missing_identity" };
    if (issuer !== this.options.issuer) return { allowed: false, reason: "missing_identity" };

    const organizationId = singleClaimValue(claims[this.options.organizationClaim]);
    if (!organizationId) {
      return {
        allowed: false,
        reason: Array.isArray(claims[this.options.organizationClaim])
          ? "ambiguous_organization"
          : "missing_organization",
      };
    }

    const identity: CallerIdentity = {
      issuer,
      subject,
      clientId,
      organizationId,
    };
    return { allowed: true, identity };
  }
}
