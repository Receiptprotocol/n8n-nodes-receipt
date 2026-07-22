/* eslint-disable @n8n/community-nodes/no-restricted-imports, import-x/no-unresolved */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const workflow = readFileSync(resolve(root, ".github/workflows/publish.yml"), "utf8");

describe("npm release contract", () => {
  test("uses the guarded @n8n/node-cli release path", () => {
    expect(packageJson.scripts.release).toBe("n8n-node release");
    expect(packageJson.scripts.prepublishOnly).toBe("n8n-node prerelease");
    expect(workflow).toContain("npm run release");
    expect(workflow).not.toMatch(/\bnpm publish\b/);
  });

  test("binds the version tag and provenance repository", () => {
    expect(packageJson.name).toBe("n8n-nodes-receipt");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.repository.url).toBe(
      "git+https://github.com/Receiptprotocol/n8n-nodes-receipt.git",
    );
    expect(workflow).toContain("- 'v*.*.*'");
    expect(workflow).toContain("process.env.GITHUB_REF_NAME !== `v${p.version}`");
  });
});
