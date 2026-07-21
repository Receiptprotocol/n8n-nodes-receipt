import type {
  IExecuteFunctions,
  IDataObject,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { fileInput, normalizeBaseUrl, parseJsonObject, recipients } from "./input";
import {
  verifyOpenReceipt,
  verifyOpenReceiptBundle,
  verifyLegacyReceipt,
  type IssuerMetadata,
  type OpenReceiptBundle,
  type OpenReceiptEvent,
} from "./open-receipt";
import type { GetOutcomeRequest, GetOutcomeResponse } from "./types";

const operations = [
  { name: "Get an Outcome", value: "getOutcome", action: "Get an outcome" },
  { name: "Discover", value: "discover", action: "Discover eligible Receipt supply" },
  { name: "Verify a Receipt", value: "verifyReceipt", action: "Verify an Open Receipt locally" },
] as const;

function stringParameter(context: IExecuteFunctions, name: string, itemIndex: number): string {
  return context.getNodeParameter(name, itemIndex, "") as string;
}

function optionalString(
  context: IExecuteFunctions,
  name: string,
  itemIndex: number,
): string | undefined {
  const value = stringParameter(context, name, itemIndex).trim();
  return value || undefined;
}

async function receiptRequest<T>(
  context: IExecuteFunctions,
  itemIndex: number,
  options: Omit<IHttpRequestOptions, "url"> & { path: string },
): Promise<T> {
  const credentials = await context.getCredentials("receiptApi");
  const normalized = normalizeBaseUrl(String(credentials.baseUrl));
  if (!normalized.ok) {
    throw new NodeOperationError(context.getNode(), normalized.error, { itemIndex });
  }
  const { path, ...requestOptions } = options;
  return (await context.helpers.httpRequestWithAuthentication.call(context, "receiptApi", {
    ...requestOptions,
    url: `${normalized.value}${path}`,
    json: true,
  })) as T;
}

function actionableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown; description?: unknown };
    if (typeof candidate.description === "string") return candidate.description;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error === "string") return candidate.error;
  }
  return "Receipt request failed";
}

export class GetWithReceipt implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Get with Receipt",
    name: "getWithReceipt",
    icon: { light: "file:receipt.svg", dark: "file:receipt.dark.svg" },
    group: ["transform"],
    version: 1,
    description:
      "Ask for an outcome, discover current Receipt supply, or verify signed proof locally",
    subtitle: '={{$parameter["operation"]}}',
    defaults: { name: "Get with Receipt" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: "receiptApi",
        required: true,
        displayOptions: { show: { operation: ["getOutcome", "discover"] } },
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [...operations],
        default: "getOutcome",
      },
      {
        displayName: "Task",
        name: "task",
        type: "string",
        typeOptions: { rows: 3 },
        required: true,
        default: "",
        placeholder: "Research Receipt Protocol universal agent commerce",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Input Type",
        name: "inputType",
        type: "options",
        options: [
          { name: "Binary File", value: "binary" },
          { name: "JSON", value: "json" },
        ],
        default: "json",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Input (JSON)",
        name: "inputJson",
        type: "json",
        default: "{}",
        description:
          "Structured provider input. Expressions are resolved separately for every item.",
        displayOptions: { show: { operation: ["getOutcome"], inputType: ["json"] } },
      },
      {
        displayName: "Input Binary Field",
        name: "binaryPropertyName",
        type: "string",
        default: "data",
        description:
          "Binary property to send through Receipt. Files are capped at 5 MiB and base64 encoded.",
        displayOptions: { show: { operation: ["getOutcome"], inputType: ["binary"] } },
      },
      {
        displayName: "Maximum Budget (USD)",
        name: "maxSpend",
        type: "number",
        typeOptions: { minValue: 0, numberPrecision: 4 },
        default: 0.1,
        description: "Maximum authorized charge. Receipt policy may impose a lower limit.",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Deadline",
        name: "deadline",
        type: "dateTime",
        default: "",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Assurance Requested",
        name: "validateAs",
        type: "options",
        options: [
          { name: "Delivered", value: "delivered" },
          { name: "Validated", value: "validated" },
        ],
        default: "delivered",
        description:
          "Validated succeeds only when the selected offer has a bound validator that runs and passes",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Data Residency",
        name: "dataResidency",
        type: "string",
        default: "",
        placeholder: "US",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Allowed Data Recipients",
        name: "allowedRecipients",
        type: "string",
        default: "",
        placeholder: "seller.example, provider.example",
        description: "Optional comma-separated recipient allowlist",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Project ID",
        name: "projectId",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Client ID",
        name: "clientId",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "External Reference",
        name: "externalReference",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Idempotency Key",
        name: "idempotencyKey",
        type: "string",
        required: true,
        default: "={{$execution.id}}:{{$itemIndex}}",
        description: "Stable identity for this orchestration. Exact replay must reuse this value.",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Quote Only (Free)",
        name: "dryRun",
        type: "boolean",
        default: false,
        description:
          "Whether to discover and quote without executing a provider or charging the wallet",
        displayOptions: { show: { operation: ["getOutcome"] } },
      },
      {
        displayName: "Search Query",
        name: "query",
        type: "string",
        required: true,
        default: "",
        placeholder: "web search",
        displayOptions: { show: { operation: ["discover"] } },
      },
      {
        displayName: "Limit",
        name: "limit",
        type: "number",
        typeOptions: { minValue: 1, maxValue: 50 },
        default: 50,
        description: "Max number of results to return",
        displayOptions: { show: { operation: ["discover"] } },
      },
      {
        displayName: "Receipt Source",
        name: "receiptSource",
        type: "options",
        options: [
          { name: "Binary File", value: "binary" },
          { name: "JSON", value: "json" },
        ],
        default: "json",
        displayOptions: { show: { operation: ["verifyReceipt"] } },
      },
      {
        displayName: "Receipt or Bundle (JSON)",
        name: "receiptJson",
        type: "json",
        default: "{}",
        displayOptions: { show: { operation: ["verifyReceipt"], receiptSource: ["json"] } },
      },
      {
        displayName: "Receipt Binary Field",
        name: "receiptBinaryPropertyName",
        type: "string",
        default: "data",
        displayOptions: { show: { operation: ["verifyReceipt"], receiptSource: ["binary"] } },
      },
      {
        displayName: "Issuer Metadata (JSON)",
        name: "issuerMetadataJson",
        type: "json",
        default: "",
        description:
          "Optional cached issuer metadata containing trusted current and historical public keys",
        displayOptions: { show: { operation: ["verifyReceipt"] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const inputItems = this.getInputData();
    const output: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex += 1) {
      try {
        const operation = this.getNodeParameter("operation", itemIndex) as string;
        let response: unknown;

        if (operation === "getOutcome") {
          const inputType = this.getNodeParameter("inputType", itemIndex) as string;
          let input: Record<string, unknown>;
          if (inputType === "binary") {
            const propertyName = stringParameter(this, "binaryPropertyName", itemIndex);
            const binary = inputItems[itemIndex].binary?.[propertyName];
            if (!binary) {
              throw new NodeOperationError(
                this.getNode(),
                `Binary input '${propertyName}' was not found`,
                {
                  itemIndex,
                },
              );
            }
            const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
            const prepared = fileInput(buffer, {
              fileName: binary.fileName,
              mimeType: binary.mimeType,
            });
            if (!prepared.ok) {
              throw new NodeOperationError(this.getNode(), prepared.error, { itemIndex });
            }
            input = prepared.value;
          } else {
            const parsed = parseJsonObject(stringParameter(this, "inputJson", itemIndex));
            if (!parsed.ok) {
              throw new NodeOperationError(this.getNode(), parsed.error, { itemIndex });
            }
            input = parsed.value;
          }

          const allowedRecipients = recipients(
            stringParameter(this, "allowedRecipients", itemIndex),
          );
          const dataResidency = optionalString(this, "dataResidency", itemIndex);
          const body: GetOutcomeRequest = {
            task: stringParameter(this, "task", itemIndex),
            input,
            maxSpend: this.getNodeParameter("maxSpend", itemIndex) as number,
            deadline: optionalString(this, "deadline", itemIndex),
            validateAs: this.getNodeParameter("validateAs", itemIndex) as "delivered" | "validated",
            dataPolicy:
              dataResidency || allowedRecipients ? { dataResidency, allowedRecipients } : undefined,
            projectId: optionalString(this, "projectId", itemIndex),
            clientId: optionalString(this, "clientId", itemIndex),
            workflowRunId: this.getExecutionId(),
            externalReference: optionalString(this, "externalReference", itemIndex),
            idempotencyKey: stringParameter(this, "idempotencyKey", itemIndex),
            dryRun: this.getNodeParameter("dryRun", itemIndex) as boolean,
          };
          response = await receiptRequest<GetOutcomeResponse>(this, itemIndex, {
            method: "POST",
            path: "/v1/get",
            body,
          });
        } else if (operation === "discover") {
          const query = encodeURIComponent(stringParameter(this, "query", itemIndex));
          const limit = this.getNodeParameter("limit", itemIndex) as number;
          response = await receiptRequest<Record<string, unknown>>(this, itemIndex, {
            method: "GET",
            path: `/api/agent/tools/search?q=${query}&limit=${limit}`,
          });
        } else if (operation === "verifyReceipt") {
          const source = this.getNodeParameter("receiptSource", itemIndex) as string;
          let document: Record<string, unknown>;
          if (source === "binary") {
            const propertyName = stringParameter(this, "receiptBinaryPropertyName", itemIndex);
            const binary = inputItems[itemIndex].binary?.[propertyName];
            if (!binary) {
              throw new NodeOperationError(
                this.getNode(),
                `Receipt binary input '${propertyName}' was not found`,
                { itemIndex },
              );
            }
            if (binary.fileSize && Number(binary.fileSize) > 1024 * 1024) {
              throw new NodeOperationError(
                this.getNode(),
                "Receipt document exceeds the 1 MiB verification limit",
                { itemIndex },
              );
            }
            const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
            if (buffer.byteLength > 1024 * 1024) {
              throw new NodeOperationError(
                this.getNode(),
                "Receipt document exceeds the 1 MiB verification limit",
                { itemIndex },
              );
            }
            const parsed = parseJsonObject(buffer.toString("utf8"), "Receipt document");
            if (!parsed.ok) {
              throw new NodeOperationError(this.getNode(), parsed.error, { itemIndex });
            }
            document = parsed.value;
          } else {
            const parsed = parseJsonObject(
              stringParameter(this, "receiptJson", itemIndex),
              "Receipt document",
            );
            if (!parsed.ok) {
              throw new NodeOperationError(this.getNode(), parsed.error, { itemIndex });
            }
            document = parsed.value;
          }
          const metadataRaw = optionalString(this, "issuerMetadataJson", itemIndex);
          let issuerMetadata: IssuerMetadata | undefined;
          if (metadataRaw) {
            const parsed = parseJsonObject(metadataRaw, "Issuer metadata");
            if (!parsed.ok) {
              throw new NodeOperationError(this.getNode(), parsed.error, { itemIndex });
            }
            issuerMetadata = parsed.value as unknown as IssuerMetadata;
          }
          if (document.type === "com.receiptprotocol.receipt.v1") {
            if (!issuerMetadata) {
              const issuer = document.issuer;
              if (
                !issuer ||
                typeof issuer !== "object" ||
                Array.isArray(issuer) ||
                (issuer as Record<string, unknown>).url !== "https://receiptprotocol.com"
              ) {
                throw new NodeOperationError(
                  this.getNode(),
                  "Legacy Receipt issuer is not trusted for automatic key loading",
                  { itemIndex },
                );
              }
              issuerMetadata = (await this.helpers.httpRequest({
                method: "GET",
                url: "https://receiptprotocol.com/api/public/receipt-public-key",
                json: true,
              })) as unknown as IssuerMetadata;
            }
            response = await verifyLegacyReceipt(
              document,
              issuerMetadata as unknown as Parameters<typeof verifyLegacyReceipt>[1],
            );
          } else if (
            (document as unknown as OpenReceiptBundle).media_type ===
              "application/open-receipt+json" &&
            typeof (document as unknown as OpenReceiptBundle).event === "object"
          ) {
            response = await verifyOpenReceiptBundle(document as unknown as OpenReceiptBundle, {
              issuerMetadata,
              requireCompleteChain: true,
            });
          } else {
            response = await verifyOpenReceipt(document as unknown as OpenReceiptEvent, {
              issuerMetadata,
              requireCompleteChain: false,
            });
          }
        } else {
          throw new NodeOperationError(this.getNode(), `Unsupported operation '${operation}'`, {
            itemIndex,
          });
        }

        output.push({
          json: response as IDataObject,
          pairedItem: { item: itemIndex },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: actionableError(error) },
            pairedItem: { item: itemIndex },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), actionableError(error), { itemIndex });
      }
    }

    return [output];
  }
}
