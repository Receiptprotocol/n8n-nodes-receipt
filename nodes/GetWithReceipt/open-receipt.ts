/**
 * Dependency-free Open Receipt v0.1 verifier for the n8n community package.
 * It mirrors @receiptprotocol/open-receipt so n8n Cloud does not need to load a
 * runtime dependency. Signature verification stays local in Node WebCrypto.
 */

export type OpenReceiptEvent = {
  spec_version: "0.1";
  event_id: string;
  event_type: string;
  issuer: {
    id: string;
    metadata_url: string;
    verification_key?: VerificationKey;
  };
  issued_at: string;
  transaction_id: string;
  quote_id: string | null;
  commercial_facts: Record<string, unknown>;
  evidence: Record<string, unknown>;
  provenance: Record<string, unknown>;
  assurance: "delivered" | "validated";
  parent_event_hashes: string[];
  signing_key_id: string;
  signature: string;
};

type VerificationKey = JsonWebKey & {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  status?: "current" | "historical" | "revoked";
};

export type IssuerMetadata = {
  issuer: string;
  keys: VerificationKey[];
};

export type OpenReceiptBundle = {
  media_type: "application/open-receipt+json";
  event: OpenReceiptEvent;
  parents: OpenReceiptEvent[];
};

type VerificationResult = {
  valid: boolean;
  signature_valid: boolean;
  schema_valid: boolean;
  chain: "not_applicable" | "complete" | "partial" | "invalid";
  key_id: string | null;
  key_source: "issuer_metadata" | "embedded" | "none";
  issuer_identity_trusted: boolean;
  event_hash: string | null;
  errors: string[];
};

type LegacyKeyMetadata = {
  key_id?: string;
  algorithm?: string;
  public_key?: string;
  keys?: Array<{
    key_id: string;
    algorithm: string;
    public_key: string;
    status?: string;
  }>;
};

const eventTypes = new Set([
  "quote.issued",
  "authorization.granted",
  "execution.attempted",
  "validation.completed",
  "settlement.completed",
  "reversal.issued",
]);
const assuranceValues = new Set(["delivered", "validated"]);
const encoder = new TextEncoder();

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) throw new TypeError("not_json_value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function rawEd25519ToSpki(raw: Uint8Array): Uint8Array {
  const prefix = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const value = new Uint8Array(prefix.length + raw.length);
  value.set(prefix);
  value.set(raw, prefix.length);
  return value;
}

export async function verifyLegacyReceipt(
  value: unknown,
  metadata: LegacyKeyMetadata,
): Promise<Record<string, unknown>> {
  if (!isObject(value) || value.type !== "com.receiptprotocol.receipt.v1") {
    return { valid: false, format: "receipt-artifact-v1", errors: ["invalid_legacy_receipt"] };
  }
  const signature = value.signature;
  if (
    !isObject(signature) ||
    signature.alg !== "Ed25519" ||
    typeof signature.key_id !== "string" ||
    typeof signature.value !== "string"
  ) {
    return { valid: false, format: "receipt-artifact-v1", errors: ["invalid_signature"] };
  }
  const candidates =
    metadata.keys ??
    (metadata.key_id && metadata.algorithm && metadata.public_key
      ? [
          {
            key_id: metadata.key_id,
            algorithm: metadata.algorithm,
            public_key: metadata.public_key,
          },
        ]
      : []);
  const selected = candidates.find(
    (key) =>
      key.key_id === signature.key_id && key.algorithm === "Ed25519" && key.status !== "revoked",
  );
  if (!selected) {
    return { valid: false, format: "receipt-artifact-v1", errors: ["verification_key_not_found"] };
  }
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      rawEd25519ToSpki(decodeBase64(selected.public_key)) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const { signature: _signature, ...unsignedValue } = value;
    void _signature;
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      decodeBase64(signature.value) as BufferSource,
      encoder.encode(canonicalize(unsignedValue)) as BufferSource,
    );
    return {
      valid,
      signature_valid: valid,
      format: "receipt-artifact-v1",
      key_id: signature.key_id,
      key_source: "issuer_metadata",
      issuer_identity_trusted: valid,
      errors: valid ? [] : ["bad_signature"],
    };
  } catch {
    return { valid: false, format: "receipt-artifact-v1", errors: ["invalid_verification_key"] };
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError("malformed_base64url");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeText(value: string): string {
  return new TextDecoder().decode(decodeBase64Url(value));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashEvent(event: OpenReceiptEvent): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(canonicalize(event))),
  );
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function validate(value: unknown): string[] {
  if (!isObject(value)) return ["event_must_be_object"];
  const errors: string[] = [];
  if (value.spec_version !== "0.1") errors.push("unsupported_spec_version");
  if (typeof value.event_id !== "string" || !value.event_id) errors.push("invalid_event_id");
  if (typeof value.event_type !== "string" || !eventTypes.has(value.event_type)) {
    errors.push("invalid_event_type");
  }
  if (
    !isObject(value.issuer) ||
    typeof value.issuer.id !== "string" ||
    typeof value.issuer.metadata_url !== "string"
  ) {
    errors.push("invalid_issuer");
  }
  if (typeof value.issued_at !== "string" || Number.isNaN(Date.parse(value.issued_at))) {
    errors.push("invalid_issued_at");
  }
  if (typeof value.transaction_id !== "string" || !value.transaction_id) {
    errors.push("invalid_transaction_id");
  }
  if (value.quote_id !== null && typeof value.quote_id !== "string")
    errors.push("invalid_quote_id");
  if (!isObject(value.commercial_facts)) errors.push("invalid_commercial_facts");
  if (!isObject(value.evidence)) errors.push("invalid_evidence");
  if (!isObject(value.provenance)) errors.push("invalid_provenance");
  if (typeof value.assurance !== "string" || !assuranceValues.has(value.assurance)) {
    errors.push("invalid_assurance");
  }
  if (
    !Array.isArray(value.parent_event_hashes) ||
    value.parent_event_hashes.some(
      (hash) => typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(hash),
    )
  ) {
    errors.push("invalid_parent_event_hashes");
  }
  if (typeof value.signing_key_id !== "string" || !value.signing_key_id) {
    errors.push("invalid_signing_key_id");
  }
  if (typeof value.signature !== "string" || !value.signature) errors.push("invalid_signature");
  return errors;
}

function unsigned(event: OpenReceiptEvent): Omit<OpenReceiptEvent, "signature"> {
  const { signature: _signature, ...value } = event;
  void _signature;
  return value;
}

async function verifySignature(
  event: OpenReceiptEvent,
  metadata?: IssuerMetadata,
): Promise<{
  valid: boolean;
  keyId: string | null;
  source: VerificationResult["key_source"];
  trusted: boolean;
  error?: string;
}> {
  try {
    const segments = event.signature.split(".");
    if (segments.length !== 3 || segments[1] !== "" || !segments[0] || !segments[2]) {
      throw new TypeError("malformed_detached_jws");
    }
    const header = JSON.parse(decodeText(segments[0])) as Record<string, unknown>;
    if (header.alg !== "EdDSA") throw new TypeError("unsupported_jws_algorithm");
    if (header.typ !== "open-receipt+jws") throw new TypeError("invalid_jws_type");
    if (typeof header.kid !== "string" || header.kid !== event.signing_key_id) {
      throw new TypeError("signing_key_id_mismatch");
    }
    const metadataKey =
      metadata?.issuer === event.issuer.id
        ? metadata.keys.find(
            (key) =>
              key.kid === header.kid &&
              key.kty === "OKP" &&
              key.crv === "Ed25519" &&
              key.status !== "revoked",
          )
        : undefined;
    const embedded = event.issuer.verification_key;
    const key = metadataKey ?? (embedded?.kid === header.kid ? embedded : undefined);
    if (!key) throw new TypeError("verification_key_not_found");
    const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const payload = encodeBase64Url(encoder.encode(canonicalize(unsigned(event))));
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      cryptoKey,
      decodeBase64Url(segments[2]) as BufferSource,
      encoder.encode(`${segments[0]}.${payload}`) as BufferSource,
    );
    return {
      valid,
      keyId: header.kid,
      source: metadataKey ? "issuer_metadata" : "embedded",
      trusted: Boolean(metadataKey),
      ...(valid ? {} : { error: "bad_signature" }),
    };
  } catch (error) {
    return {
      valid: false,
      keyId: null,
      source: "none",
      trusted: false,
      error: error instanceof Error ? error.message : "malformed_signature",
    };
  }
}

export async function verifyOpenReceipt(
  value: unknown,
  options: {
    issuerMetadata?: IssuerMetadata;
    parentEvents?: OpenReceiptEvent[];
    requireCompleteChain?: boolean;
  } = {},
): Promise<VerificationResult> {
  const errors = validate(value);
  if (errors.length > 0) {
    return {
      valid: false,
      signature_valid: false,
      schema_valid: false,
      chain: "invalid",
      key_id: null,
      key_source: "none",
      issuer_identity_trusted: false,
      event_hash: null,
      errors,
    };
  }
  const event = value as OpenReceiptEvent;
  const signature = await verifySignature(event, options.issuerMetadata);
  if (signature.error) errors.push(signature.error);
  let chain: VerificationResult["chain"] = "not_applicable";
  if (event.parent_event_hashes.length > 0) {
    if (!options.parentEvents) {
      chain = options.requireCompleteChain ? "invalid" : "partial";
      if (options.requireCompleteChain) errors.push("parent_events_missing");
    } else {
      const hashes = new Set(await Promise.all(options.parentEvents.map(hashEvent)));
      const missing = event.parent_event_hashes.filter((hash) => !hashes.has(hash));
      chain =
        missing.length === 0 ? "complete" : options.requireCompleteChain ? "invalid" : "partial";
      if (missing.length > 0) errors.push("parent_hash_not_found");
    }
  }
  return {
    valid: signature.valid && chain !== "invalid",
    signature_valid: signature.valid,
    schema_valid: true,
    chain,
    key_id: signature.keyId,
    key_source: signature.source,
    issuer_identity_trusted: signature.trusted,
    event_hash: await hashEvent(event),
    errors,
  };
}

export async function verifyOpenReceiptBundle(
  bundle: OpenReceiptBundle,
  options: { issuerMetadata?: IssuerMetadata; requireCompleteChain?: boolean } = {},
): Promise<VerificationResult> {
  if (
    !isObject(bundle) ||
    bundle.media_type !== "application/open-receipt+json" ||
    !Array.isArray(bundle.parents)
  ) {
    return {
      valid: false,
      signature_valid: false,
      schema_valid: false,
      chain: "invalid",
      key_id: null,
      key_source: "none",
      issuer_identity_trusted: false,
      event_hash: null,
      errors: ["invalid_bundle"],
    };
  }
  const parentResults = await Promise.all(
    bundle.parents.map((parent) =>
      verifyOpenReceipt(parent, { issuerMetadata: options.issuerMetadata }),
    ),
  );
  const result = await verifyOpenReceipt(bundle.event, {
    issuerMetadata: options.issuerMetadata,
    parentEvents: bundle.parents,
    requireCompleteChain: options.requireCompleteChain ?? true,
  });
  if (parentResults.some((parent) => !parent.valid)) {
    return {
      ...result,
      valid: false,
      chain: "invalid",
      errors: [...result.errors, "invalid_parent_event"],
    };
  }
  return result;
}
