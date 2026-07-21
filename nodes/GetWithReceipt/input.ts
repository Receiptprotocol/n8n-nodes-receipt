const MAX_BINARY_BYTES = 5 * 1024 * 1024;

type InputResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseJsonObject(
  raw: string,
  label = "Input",
): InputResult<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `${label} must be valid JSON` };
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    return { ok: false, error: `${label} must be a JSON object` };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function fileInput(
  buffer: Buffer,
  metadata: { fileName?: string; mimeType?: string },
): InputResult<Record<string, unknown>> {
  if (buffer.byteLength > MAX_BINARY_BYTES) {
    return { ok: false, error: "Input file exceeds the 5 MiB n8n community-node limit" };
  }
  return {
    ok: true,
    value: {
      file: {
        name: metadata.fileName ?? "input",
        mediaType: metadata.mimeType ?? "application/octet-stream",
        encoding: "base64",
        data: buffer.toString("base64"),
        size: buffer.byteLength,
      },
    },
  };
}

export function recipients(raw: string): string[] | undefined {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function normalizeBaseUrl(raw: string): InputResult<string> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Receipt API Base URL must be a valid URL" };
  }
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    return {
      ok: false,
      error: "Receipt API Base URL must use HTTPS unless it is a loopback address",
    };
  }
  return { ok: true, value: parsed.origin };
}
