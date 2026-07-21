/* eslint-disable @n8n/community-nodes/no-restricted-imports, import-x/no-unresolved */
import { describe, expect, test } from "bun:test";
import {
  fileInput,
  normalizeBaseUrl,
  parseJsonObject,
  recipients,
} from "../nodes/GetWithReceipt/input";

describe("Get with Receipt input handling", () => {
  test("accepts object JSON and rejects non-object input", () => {
    expect(parseJsonObject('{"query":"receipt"}')).toEqual({
      ok: true,
      value: { query: "receipt" },
    });
    expect(parseJsonObject("[1,2]")).toEqual({
      ok: false,
      error: "Input must be a JSON object",
    });
    expect(parseJsonObject("nope")).toEqual({
      ok: false,
      error: "Input must be valid JSON",
    });
  });

  test("encodes bounded binary data without writing a file", () => {
    expect(fileInput(Buffer.from("hello"), { fileName: "brief.txt", mimeType: "text/plain" })).toEqual({
      ok: true,
      value: {
        file: {
          name: "brief.txt",
          mediaType: "text/plain",
          encoding: "base64",
          data: "aGVsbG8=",
          size: 5,
        },
      },
    });
    expect(fileInput(Buffer.alloc(5 * 1024 * 1024 + 1), {})).toMatchObject({
      ok: false,
      error: expect.stringContaining("5 MiB"),
    });
  });

  test("parses a recipient allowlist", () => {
    expect(recipients(" seller.example, provider.example, ")).toEqual([
      "seller.example",
      "provider.example",
    ]);
    expect(recipients("")).toBeUndefined();
  });

  test("requires HTTPS except for loopback development", () => {
    expect(normalizeBaseUrl("https://receiptprotocol.com/path")).toEqual({
      ok: true,
      value: "https://receiptprotocol.com",
    });
    expect(normalizeBaseUrl("http://localhost:3000")).toEqual({
      ok: true,
      value: "http://localhost:3000",
    });
    expect(normalizeBaseUrl("http://receipt.example")).toMatchObject({
      ok: false,
      error: expect.stringContaining("must use HTTPS"),
    });
  });
});
