const SENSITIVE_ERROR_PATTERN =
  /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization\s*[:=]|authorization\s+(?:bearer|basic)\b|bearer\s+[A-Za-z0-9._~+/=-]{8,}|realm[_-]?id|https?:\/\/|postgres(?:ql)?|database|sqlstate|stack trace|\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b)/i;

function safeMessage(message: string): string {
  const trimmed = message.trim();
  // Provider bodies are frequently JSON/XML and may contain credentials,
  // realm identifiers, or internal trace data. Treat structured or sensitive
  // messages as opaque upstream failures rather than attempting field-level
  // redaction that can miss a provider-specific shape.
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[") || SENSITIVE_ERROR_PATTERN.test(trimmed)) {
    return "The upstream QuickBooks request failed";
  }
  return trimmed.length > 512 ? `${trimmed.slice(0, 512)}…` : trimmed;
}

function safeUnknown(error: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
  if (serialized === undefined) return String(error);
  if (SENSITIVE_ERROR_PATTERN.test(serialized)) return "Unknown error";
  return serialized.length > 512 ? `${serialized.slice(0, 512)}…` : serialized;
}

/**
 * Formats an error into a bounded, metadata-safe message. Provider response
 * bodies and infrastructure details never cross the MCP error boundary.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${safeMessage(error.message)}`;
  } else if (typeof error === 'string') {
    return `Error: ${safeMessage(error)}`;
  } else {
    return `Unknown error: ${safeUnknown(error)}`;
  }
}
