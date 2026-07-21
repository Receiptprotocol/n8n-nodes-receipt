export type GetStatus =
  | "completed"
  | "requires_approval"
  | "no_eligible_provider"
  | "deadline_unreachable"
  | "policy_blocked"
  | "provider_failed"
  | "validation_failed";

export interface ReceiptMoney {
  amount: string;
  currency: string;
  amountMinor: number;
}

export interface GetOutcomeRequest {
  task: string;
  input: Record<string, unknown>;
  maxSpend?: number;
  deadline?: string;
  validateAs?: "delivered" | "validated";
  dataPolicy?: {
    dataResidency?: string;
    allowedRecipients?: string[];
  };
  projectId?: string;
  clientId?: string;
  workflowRunId?: string;
  externalReference?: string;
  idempotencyKey: string;
  dryRun?: boolean;
  approvalId?: string;
}

export interface GetOutcomeResponse extends Record<string, unknown> {
  status: GetStatus;
  result: unknown;
  seller: { id: string; name: string; verificationLevel: string | null } | null;
  provider: { operation: string; capability: string } | null;
  assurance: "Delivered" | "Validated" | null;
  quotedMaximum: ReceiptMoney | null;
  finalCharge: ReceiptMoney | null;
  validation: { ran: boolean; status: string; runId: string | null } | null;
  transactionId: string | null;
  receiptUrl: string | null;
  signedReceiptUrl: string | null;
  verifyUrl: string | null;
}
