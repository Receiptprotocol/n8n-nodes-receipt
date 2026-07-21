import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from "n8n-workflow";

export class ReceiptApi implements ICredentialType {
  name = "receiptApi";

  displayName = "Receipt API";

  icon: Icon = {
    light: "file:../nodes/GetWithReceipt/receipt.svg",
    dark: "file:../nodes/GetWithReceipt/receipt.dark.svg",
  };

  documentationUrl = "https://receiptprotocol.com/docs/get";

  properties: INodeProperties[] = [
    {
      displayName: "Developer Credential",
      name: "accessToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        "A Receipt developer access token. No seller or downstream provider key is required.",
    },
    {
      displayName: "API Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://receiptprotocol.com",
      required: true,
      description:
        "Receipt API origin. Change this only for a trusted local or staging Receipt environment.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.accessToken}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/api/agent/wallet",
      method: "GET",
    },
  };
}
