/* eslint-disable @n8n/community-nodes/no-dangerous-functions, @n8n/community-nodes/no-restricted-globals, @n8n/community-nodes/no-restricted-imports, import-x/no-unresolved */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "n8n-nodes-receipt-release-integrity-"));
const npmCache = join(scratch, "npm-cache");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const requiredBuildFiles = [
  "dist/credentials/ReceiptApi.credentials.js",
  "dist/nodes/GetWithReceipt/GetWithReceipt.node.js",
  "dist/nodes/GetWithReceipt/input.js",
  "dist/nodes/GetWithReceipt/open-receipt.js",
];

const requiredPackedFiles = [
  ...requiredBuildFiles,
  "dist/nodes/GetWithReceipt/receipt.dark.svg",
  "dist/nodes/GetWithReceipt/receipt.svg",
  "README.md",
  "LICENSE",
  "workflows/slack-budget-approval.json",
  "workflows/web-research-under-10-cents.json",
];

function run(command: string, args: string[], cwd = root): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: npmCache },
  });
}

function expectBuildOutputs(): void {
  for (const path of requiredBuildFiles) {
    expect(existsSync(resolve(root, path)), path).toBe(true);
  }
}

afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

describe("release artifact integrity", () => {
  test(
    "emits, packs, and installs every declared n8n entrypoint",
    () => {
      rmSync(resolve(root, "dist"), { force: true, recursive: true });
      rmSync(resolve(root, "node_modules/.cache/n8n-nodes-receipt.tsbuildinfo"), {
        force: true,
      });
      rmSync(resolve(root, "tsconfig.tsbuildinfo"), { force: true });

      run("npm", ["run", "build"]);
      expectBuildOutputs();

      run("npm", ["run", "build"]);
      expectBuildOutputs();

      const dryRun = JSON.parse(run("npm", ["pack", "--dry-run", "--json"]));
      const packedFiles = new Set<string>(dryRun[0].files.map(({ path }: { path: string }) => path));

      for (const path of requiredPackedFiles) {
        expect(packedFiles.has(path), path).toBe(true);
      }

      expect(packageJson.publishConfig.access).toBe("public");
      for (const path of [...packageJson.n8n.credentials, ...packageJson.n8n.nodes]) {
        expect(packedFiles.has(path), path).toBe(true);
      }

      const packDirectory = join(scratch, "pack");
      const installDirectory = join(scratch, "install");
      mkdirSync(packDirectory, { recursive: true });
      mkdirSync(installDirectory, { recursive: true });
      writeFileSync(join(installDirectory, "package.json"), '{"private":true}\n');

      const packed = JSON.parse(
        run("npm", ["pack", "--json", "--pack-destination", packDirectory]),
      );
      const tarball = join(packDirectory, packed[0].filename);
      run("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps", tarball], installDirectory);

      const resolveFromInstall = createRequire(join(installDirectory, "package.json")).resolve;
      for (const path of [...packageJson.n8n.credentials, ...packageJson.n8n.nodes]) {
        expect(resolveFromInstall(`${packageJson.name}/${path}`)).toBe(
          realpathSync(join(installDirectory, "node_modules", packageJson.name, path)),
        );
      }
    },
    120_000,
  );
});
