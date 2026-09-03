import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  CallerIdentity,
} from "./contracts.js";

export type ClaimBindingPolicyOptions = {
  issuer: string;
  organizationClaim: string;
  /**
   * OAuth client ids permitted to reach this resource server. AuthCo mints a
   * token for this resource for any client a user consents to, so the audience
   * alone does not establish who is calling; without this list a third-party
   * client could carry a user's organization all the way to Finance's lease.
   *
   * An empty list disables the check, which is reachable only in temporary
   * unauthenticated mode. Every other deployment fails to start without it.
   */
  allowedClientIds: readonly string[];
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function singleClaimValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Extract caller authority from verified AuthCo claims. */
export class ClaimBindingAuthorizationPolicy implements AuthorizationPolicy {
  private readonly allowedClientIds: ReadonlySet<string>;

  constructor(private readonly options: ClaimBindingPolicyOptions) {
    if (!options.issuer.trim() || !options.organizationClaim.trim()) {
      throw new Error("Issuer and organization claim names are required");
    }
    this.allowedClientIds = new Set(options.allowedClientIds);
  }

  authorize(claims: Readonly<Record<string, unknown>>): AuthorizationDecision {
    const issuer = nonEmptyString(claims.iss);
    const subject = nonEmptyString(claims.sub);
    const clientId = nonEmptyString(claims.client_id) ?? nonEmptyString(claims.azp);
    if (!issuer || !subject || !clientId || issuer !== this.options.issuer) {
      return { allowed: false, reason: "missing_identity" };
    }

    // Checked before the organization, so an unknown client is turned away on
    // its identity alone and never on the strength of what it asked for.
    if (this.allowedClientIds.size > 0 && !this.allowedClientIds.has(clientId)) {
      return { allowed: false, reason: "client_not_allowed" };
    }

    const organizationId = singleClaimValue(claims[this.options.organizationClaim]);
    if (!organizationId) {
      return {
        allowed: false,
        reason: Array.isArray(claims[this.options.organizationClaim])
          ? "ambiguous_organization"
          : "missing_organization",
      };
    }

    // The subject is a person for a user-delegated token and the client itself
    // for a machine token, where `sub` equals the client id. Neither grants
    // anything by itself: the organization above is the whole authority the
    // token carries, and Finance re-checks the company and the employee's
    // authorization when it issues the lease.
    const identity: CallerIdentity = {
      issuer,
      subject,
      clientId,
      organizationId,
    };

    return { allowed: true, identity };
  }
}
