import https from "https";
import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { inferContentType } from "../helpers/infer-content-type.js";

// QBO Attachable upload — file types accepted by the QBO /upload endpoint.
// Source: developer.intuit.com Attachable API reference (16 unique MIME types
// covering 17 documented file extensions; .ai and .eps both map to
// application/postscript).
//
// Two entries deviate from RFC standards but match QBO's documented spec
// literally — keep them so payloads round-trip without QBO rejecting them:
//   - image/jpg  (RFC standard is image/jpeg; QBO accepts both)
//   - image/tif  (RFC standard is image/tiff; QBO accepts both)
//
// One entry is corrected from a documentation typo:
//   - QBO docs list application/vnd/ms-excel for .xls. A forward slash in a
//     MIME subtype is invalid per RFC 6838. We use the correct form here.
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "application/postscript",          // .ai, .eps
  "text/csv",                        // .csv
  "application/msword",              // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "image/gif",                       // .gif
  "image/jpeg",                      // .jpeg
  "image/jpg",                       // .jpg
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  "application/pdf",                 // .pdf
  "image/png",                       // .png
  "text/rtf",                        // .rtf
  "image/tif",                       // .tif
  "text/plain",                      // .txt
  "application/vnd.ms-excel",        // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/xml",                        // .xml
]);

// Remote MCP requests must remain within the configured HTTP body limit after
// base64 expansion and JSON framing. Larger artifacts require the future
// private ArtifactStore adapter; they are not accepted through process files,
// arbitrary URLs, or oversized inline bodies.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// Approximate decoded size of a base64 string without decoding it. base64
// expands 3 bytes -> 4 chars; subtract padding to get the decoded length.
function approximateDecodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface CreateAttachableInput {
  file_name: string;
  note?: string;
  category?: string;
  content_type?: string;
  base64_content?: string;
  attachable_ref?: {
    entity_ref_type: string;
    entity_ref_value: string;
    include_on_send?: boolean;
  };
}

// Remote HTTP accepts only bounded inline bytes. Host filesystem paths and
// arbitrary server-side URL downloads are not part of the tool contract.
type UploadFileSource = { buffer: Buffer };

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, "_");
}

// Map a status code to a user-safe error message. The raw QBO response body
// can include realm IDs, internal trace identifiers, and other detail that
// should not be returned to an MCP client — the LLM has no business seeing
// internal QBO error envelopes. Raw bodies are still logged server-side for
// operator debugging.
function redactedUploadError(statusCode: number | undefined): string {
  if (!statusCode) return "QBO upload failed: network error";
  if (statusCode === 401 || statusCode === 403) return `QBO upload failed (${statusCode}): authentication or authorization error`;
  if (statusCode === 413) return `QBO upload failed (${statusCode}): payload too large`;
  if (statusCode >= 400 && statusCode < 500) return `QBO upload failed (${statusCode}): client error`;
  if (statusCode >= 500) return `QBO upload failed (${statusCode}): QBO server error`;
  /* istanbul ignore next — defensive: <400 status codes never reach this function */
  return `QBO upload failed (${statusCode}): unexpected status`;
}

// Raw multipart/form-data POST to /v3/company/{realmId}/upload. node-quickbooks
// does not wrap this endpoint, so we construct the request manually.
//
// QBO supports multi-file uploads in a single request, but this handler sends
// exactly one file per request — single-file covers the 99% MCP/LLM case and
// multi-file would require a different input schema. Out of scope here.
async function uploadAttachableFile(
  file: UploadFileSource,
  metadata: Record<string, unknown>,
  accessToken: string,
  realmId: string,
  isSandbox: boolean
): Promise<unknown> {
  const boundary = `----QBOBoundary${Date.now()}`;
  const metadataJson = JSON.stringify(metadata);
  const fileName = sanitizeFilename(metadata.FileName as string);
  const contentType = metadata.ContentType as string;

  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_metadata_01"\r\n` +
      `Content-Type: application/json\r\n` +
      `\r\n` +
      `${metadataJson}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_content_01"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `\r\n`
  );
  const closer = Buffer.from(`\r\n--${boundary}--\r\n`);
  // Exact Content-Length lets us stream the file part without chunked
  // transfer encoding, which the QBO endpoint does not reliably accept.
  const fileSize = file.buffer.length;
  const contentLength = preamble.length + fileSize + closer.length;

  const host = isSandbox
    ? "sandbox-quickbooks.api.intuit.com"
    : "quickbooks.api.intuit.com";
  const requestPath = `/v3/company/${realmId}/upload`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: requestPath,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": contentLength,
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            console.error(`[qbo-attachable-upload] QBO request failed with status ${res.statusCode}`);
            reject(new Error(redactedUploadError(res.statusCode)));
            return;
          }
          try {
            resolve(JSON.parse(responseText) as unknown);
          } catch {
            console.error(`[qbo-attachable-upload] QBO returned a non-JSON response with status ${res.statusCode}`);
            reject(new Error(redactedUploadError(res.statusCode)));
          }
        });
      }
    );
    req.on("error", (err) => {
      console.error(`[qbo-attachable-upload] network error: ${err.message}`);
      reject(new Error(redactedUploadError(undefined)));
    });

    req.write(preamble);
    req.write(file.buffer);
    req.write(closer);
    req.end();
  });
}

export async function createQuickbooksAttachable(
  data: CreateAttachableInput
): Promise<ToolResponse<any>> {
  try {
    // Build payload — same shape whether or not we're uploading binary content.
    const payload: Record<string, unknown> = { FileName: data.file_name };
    if (data.note) payload.Note = data.note;
    if (data.category) payload.Category = data.category;
    if (data.content_type) payload.ContentType = data.content_type;
    if (data.attachable_ref) {
      const entityRef: Record<string, unknown> = {
        EntityRef: {
          type: data.attachable_ref.entity_ref_type,
          value: data.attachable_ref.entity_ref_value,
        },
      };
      if (typeof data.attachable_ref.include_on_send === "boolean") {
        entityRef.IncludeOnSend = data.attachable_ref.include_on_send;
      }
      payload.AttachableRef = [entityRef];
    }

    // ── Binary upload path ────────────────────────────────────────────────
    const hasFileSource = Boolean(data.base64_content);
    if (hasFileSource) {
      let fileSource: UploadFileSource;
      {
        // base64 path — validate the content type BEFORE decoding, so an
        // unsupported type is rejected without allocating the decoded buffer
        // (same error precedence as the original implementation).
        const preliminaryType =
          data.content_type ?? inferContentType(data.file_name) ?? "application/octet-stream";
        if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(preliminaryType)) {
          return {
            result: null,
            isError: true,
            error: `Unsupported content_type "${preliminaryType}". Allowed: ${[...ALLOWED_UPLOAD_CONTENT_TYPES].sort().join(", ")}`,
          };
        }
        // Enforce size cap BEFORE decoding to a Buffer.
        const approxSize = approximateDecodedSize(data.base64_content!);
        if (approxSize > MAX_UPLOAD_BYTES) {
          return {
            result: null,
            isError: true,
            error: `File too large for inline remote upload: approximately ${approxSize} bytes exceeds ${MAX_UPLOAD_BYTES} bytes.`,
          };
        }
        const fileBuffer = Buffer.from(data.base64_content!, "base64");
        /* istanbul ignore next — defensive: the approxSize check above already
           rejects oversized input; this guards only the malformed-base64 edge
           case where decoded length unexpectedly exceeds the approximation. */
        if (fileBuffer.length > MAX_UPLOAD_BYTES) {
          return {
            result: null,
            isError: true,
            error: `File too large for inline remote upload: ${fileBuffer.length} bytes exceeds ${MAX_UPLOAD_BYTES} bytes.`,
          };
        }
        fileSource = { buffer: fileBuffer };
      }

      {
        // Content type: explicit override, then inference from file_name.
        const effectiveContentType =
          data.content_type ??
          inferContentType(data.file_name) ??
          "application/octet-stream";
        if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(effectiveContentType)) {
          return {
            result: null,
            isError: true,
            error: `Unsupported content_type "${effectiveContentType}". Allowed: ${[...ALLOWED_UPLOAD_CONTENT_TYPES].sort().join(", ")}`,
          };
        }
        payload.ContentType = effectiveContentType;

        const { accessToken, realmId, isSandbox } =
          await QuickbooksClient.getAuthCredentials();
        const uploadResult = await uploadAttachableFile(
          fileSource,
          payload,
          accessToken,
          realmId,
          isSandbox
        );
        return { result: uploadResult, isError: false, error: null };
      }
    }

    // ── Metadata-only path (preserved behavior, post-#41 auth) ────────────
    const quickbooks = await QuickbooksClient.getInstance();
    return new Promise((resolve) => {
      (quickbooks as any).createAttachable(payload, (err: any, created: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: created, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
