import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  CallerIdentity,
} from "./contracts.js";

export const STAFF_ACCOUNTANT_AGENT_BRIDGE_CLIENT_ID =
  "staff-accountant-agent-bridge";
export const AGENT_ID_CLAIM = "https://devraftel.com/agent_id";
/** @deprecated Company selection is supplied as trusted per-call metadata. */
export const COMPANY_ID_CLAIM = "https://devraftel.com/company_id";
export const QUICKBOOKS_ENVIRONMENT_CLAIM =
  "https://devraftel.com/quickbooks_environment";

export type ClaimBindingPolicyOptions = {
  issuer: string;
  organizationClaim: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function singleClaimValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Extract caller authority from verified AuthCo claims. */
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
    if (!issuer || !subject || !clientId || issuer !== this.options.issuer) {
      return { allowed: false, reason: "missing_identity" };
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

    const identity: CallerIdentity = {
      issuer,
      subject,
      clientId,
      organizationId,
    };

    if (clientId === STAFF_ACCOUNTANT_AGENT_BRIDGE_CLIENT_ID) {
      const agentId = singleClaimValue(claims[AGENT_ID_CLAIM]);
      const environment = singleClaimValue(claims[QUICKBOOKS_ENVIRONMENT_CLAIM]);
      if (!agentId || environment !== "sandbox") {
        return { allowed: false, reason: "missing_agent_binding" };
      }
      identity.agentId = agentId;
      identity.environment = "sandbox";
    }

    return { allowed: true, identity };
  }
}
