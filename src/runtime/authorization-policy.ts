import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  CallerIdentity,
} from "./contracts.js";

export type ClaimBindingPolicyOptions = {
  issuer: string;
  organizationClaim: string;
  connectionClaim: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Return one claim value only. Arrays are intentionally rejected, even when
 * they contain one item: an MCP access token represents exactly one
 * organization and one QuickBooks connection.
 */
function singleClaimValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Extracts the complete connection grant without coupling the resource server
 * to an authorization-vendor claim name. The control plane decides which
 * organization/connection is legal; this policy only verifies that the signed
 * token carries one well-formed value for each configured claim.
 */
export class ClaimBindingAuthorizationPolicy implements AuthorizationPolicy {
  constructor(private readonly options: ClaimBindingPolicyOptions) {
    if (!options.issuer.trim() || !options.organizationClaim.trim() || !options.connectionClaim.trim()) {
      throw new Error("Issuer, organization, and connection claim names are required");
    }
    if (options.organizationClaim === options.connectionClaim) {
      throw new Error("Organization and connection claims must be distinct");
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

    const qboConnectionId = singleClaimValue(claims[this.options.connectionClaim]);
    if (!qboConnectionId) {
      return {
        allowed: false,
        reason: Array.isArray(claims[this.options.connectionClaim])
          ? "ambiguous_connection"
          : "missing_connection",
      };
    }

    const identity: CallerIdentity = {
      issuer,
      subject,
      clientId,
      organizationId,
      qboConnectionId,
      claims,
    };
    return { allowed: true, identity };
  }
}
