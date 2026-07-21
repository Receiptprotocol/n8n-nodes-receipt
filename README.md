# n8n-nodes-receipt

`Get with Receipt` lets an n8n workflow ask for an outcome through Receipt's existing commerce engine. Receipt selects from currently eligible Receipt supply, applies the wallet policy, discloses the seller and price, executes at most once for a stable idempotency key, and returns result and signed-Receipt links.

The package is a community node artifact. An official n8n catalogue listing is pending.

## Operations

- **Get an outcome** calls `POST /v1/get` and returns its complete typed result.
- **Discover** searches current Receipt supply without purchasing.
- **Verify a Receipt** checks Open Receipt v0.1 signatures and parent hashes locally. It also verifies completed Receipt Artifact v1 files returned by the current Get path. For an Artifact v1 file, it may load Receipt's published public key from the fixed Receipt issuer URL; the cryptographic verdict is still computed inside the node. It does not ask Receipt's verification API whether the signature is valid.

`Delivered` means the provider response was delivered. `Validated` is returned only when the offer's bound validator actually ran and passed.

## Authentication

Create one **Receipt API** credential containing a Receipt developer token. A downstream seller login, provider account, and provider API key are not required. Keep the production base URL at `https://receiptprotocol.com`.

## Local installation proof

With Node 20.15 or newer and a local n8n installation:

```bash
git clone https://github.com/Receiptprotocol/n8n-nodes-receipt.git
cd n8n-nodes-receipt
npm install
npm run build
npm pack

mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/to/n8n-nodes-receipt-0.1.0.tgz
n8n start
```

For local development, `npm run dev` uses n8n's official community-node development runner.

## Idempotency and approvals

The default idempotency key contains n8n's execution ID and item index. Keep that value stable when retrying the same intended purchase. A new intended purchase must use a new key.

Use **Quote Only (Free)** to disclose the selected seller and quoted maximum without executing or charging. The included approval workflow uses a quote key and a separate purchase key so approval does not replay the dry run.

Expected business outcomes such as `policy_blocked`, `requires_approval`, or `validation_failed` are returned as data. Authentication, malformed input, and infrastructure failures produce actionable node errors and respect n8n's Continue On Fail behavior.

## Files and privacy

Binary provider input is limited to 5 MiB and sent as base64 with its filename and media type. Receipt JSON used for local verification is limited to 1 MiB. The node never writes credentials or input files to disk.

## Templates

- [`workflows/web-research-under-10-cents.json`](./workflows/web-research-under-10-cents.json): low-cost web research, signed-Receipt download, and local verification.
- [`workflows/slack-budget-approval.json`](./workflows/slack-budget-approval.json): quote first, continue within policy, or request Slack approval before purchasing.

## Publishing

The package is npm-ready but is not claimed as published until its owner runs the release workflow and the registry returns the public package. Official n8n community-directory review is a separate owner action and does not block local installation.
