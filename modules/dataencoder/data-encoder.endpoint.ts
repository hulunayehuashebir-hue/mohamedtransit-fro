import { API_ROUTES } from "@/modules/api";
import { service } from "@/modules/utils/axios/service";

const readProxyResponse = async (
  response: Response,
  resource: string,
): Promise<unknown> => {
  if (response.status === 204) return [];

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      if (response.ok) {
        throw new Error(`The ${resource} endpoint returned invalid JSON.`);
      }
      body = text;
    }
  }

  if (!response.ok && response.status !== 400 && response.status !== 409) {
    if (typeof body === "string" && body.trim()) {
      throw new Error(body);
    }
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      const message = [record.message, record.detail, record.error, record.title].find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      );
      if (message) throw new Error(message);
    }
    throw new Error(`${resource} request failed (${response.status}).`);
  }

  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (record.error === true || record.isError === true) {
      const message = [record.message, record.detail].find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      );
      throw new Error(message ?? `${resource} request was rejected.`);
    }
  }

  return body;
};

const getProxyJson = async (url: string, resource: string): Promise<unknown> =>
  readProxyResponse(
    await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
    resource,
  );

export interface CustomerAccountOption {
  id: string;
  label: string;
  email?: string;
}

export const normalizeCustomerCreatePayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const submittedUserId = payload.userId;
  const normalizedStringId =
    typeof submittedUserId === "string" ? submittedUserId.trim() : null;
  if (!submittedUserId || normalizedStringId === "") {
    throw new Error("A valid customer user ID is required. Select or create an active Customer/Importer account.");
  }

  const userId = typeof submittedUserId === "string"
    ? /^\d+$/.test(normalizedStringId ?? "")
      ? Number(normalizedStringId)
      : Number.NaN
    : submittedUserId;
  if (
    typeof userId !== "number" ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    throw new Error("Select a valid active customer account or leave it blank.");
  }

  return { ...payload, userId };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findField = (record: Record<string, unknown>, ...names: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    names.some((name) => name.toLowerCase() === candidate.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const readCustomerAccounts = (value: unknown): CustomerAccountOption[] => {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (Array.isArray(current)) {
      if (!current.every(isRecord)) {
        throw new Error("The active user endpoint returned an invalid user list.");
      }

      return current.flatMap((user) => {
        const roles = findField(
          user,
          "roles",
          "userRoles",
          "roleNames",
          "roleName",
          "role",
        );
        const roleNames: string[] = [];
        const readRoleNames = (role: unknown): void => {
          if (typeof role === "string") {
            roleNames.push(role);
          } else if (Array.isArray(role)) {
            role.forEach(readRoleNames);
          } else if (isRecord(role)) {
            const name = findField(role, "roleName", "name", "displayName");
            if (typeof name === "string") roleNames.push(name);
            readRoleNames(findField(role, "role", "roles", "userRoles"));
          }
        };
        readRoleNames(roles);
        const isCustomer = roleNames.some((name) =>
          /customer|importer/i.test(name),
        );
        const lockedValue = findField(user, "isAccountLocked", "isLocked");
        const isLocked = lockedValue === true || lockedValue === 1 ||
          (typeof lockedValue === "string" && lockedValue.toLowerCase() === "true");
        if (!isCustomer || isLocked) return [];

        const idValue = findField(user, "userId", "UserId", "id");
        const id = typeof idValue === "number" || typeof idValue === "string"
          ? String(idValue).trim()
          : "";
        if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return [];

        const explicitStatuses = [
          findField(user, "isActive", "isEnabled"),
          findField(user, "accountStatus", "status", "userStatus", "recordStatus"),
        ].filter((status) => status !== undefined && status !== null && status !== "");
        const inactive = explicitStatuses.some((status) => {
          if (status === false || status === 0 || status === "0") return true;
          if (typeof status === "string") {
            const normalized = status.trim().toLowerCase();
            if (["false", "inactive", "disabled", "locked", "suspended", "pending"].includes(normalized)) {
              return true;
            }
            if (/^\d+$/.test(normalized)) return Number(normalized) !== 1;
          }
          if (typeof status === "number") return status !== 1;
          return false;
        });
        if (inactive) return [];

        const name = [
          findField(user, "firstName", "givenName"),
          findField(user, "lastName", "surname"),
        ].filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
          .join(" ");
        const username = findField(user, "username", "userName");
        const email = findField(user, "email");
        const secondaryLabel = typeof email === "string" && email.trim()
          ? email.trim()
          : typeof username === "string" && username.trim()
            ? username.trim()
            : "";
        const label = [name, secondaryLabel].filter(Boolean).join(" · ")
          || `Customer account ${id}`;
        return [{
          id,
          label,
          email: typeof email === "string" ? email.trim() : undefined,
        }];
      });
    }

    if (!isRecord(current)) break;
    const next = findField(
      current,
      "data",
      "payload",
      "response",
      "result",
      "users",
      "userList",
      "items",
      "records",
      "rows",
    );
    if (next === undefined || next === current) break;
    current = next;
  }

  throw new Error("The active user response did not contain a user list.");
};

export const DataEncoderEndpoints = {
  // Use the same-origin proxy so the server can forward the authenticated cookie.
  getDashboard: () =>
    getProxyJson("/api/encoder/dashboard", "Data Encoder dashboard"),

  // GET /api/v1/DataEncoder/GetAllCustomers/{recordStatus} via the authenticated proxy.
  getAllCustomers: (recordStatus = "1") =>
    getProxyJson(
      `/api/encoder/customers?recordStatus=${encodeURIComponent(recordStatus)}`,
      "Data Encoder customer records",
    ),

  // Browser requests use the authenticated same-origin proxy, which forwards
  // these requests to /DataEncoder/GetAllCustomers/{recordStatus}.
  getCustomerRegistry: (recordStatus = "1") =>
    fetch(
      `/api/encoder/customers?recordStatus=${encodeURIComponent(recordStatus)}`,
      { cache: "no-store", credentials: "include" }
    ),

  getActiveCustomerAccounts: async (): Promise<CustomerAccountOption[]> =>
    readCustomerAccounts(await getProxyJson(
      "/api/encoder/users",
      "Active customer accounts",
    )),

  // The proxy validates the selected customer account ID and adds the encoder ID.
  createCustomer: async (payload: Record<string, unknown>) => {
    try {
      const normalizedPayload = normalizeCustomerCreatePayload(payload);
      const response = await fetch("/api/encoder/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The proxy expects customer fields at the top level, not under `request`.
        body: JSON.stringify(normalizedPayload),
      });
      if (!response.ok) {
        const responseText = await response.clone().text();
        let responseData: unknown = responseText || null;
        if (responseText) {
          try {
            responseData = JSON.parse(responseText) as unknown;
          } catch {
            // Keep the original response text for non-JSON backend errors.
          }
        }
        console.error(
          "Customer creation request failed:\n" +
            JSON.stringify(
              {
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                contentType: response.headers.get("content-type"),
                responseData,
                rawResponseText: responseText || null,
              },
              null,
              2,
            ),
        );
      }
      return response;
    } catch (error: unknown) {
      console.error(
        "Customer creation request could not reach the API:",
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  },

  updateCustomer: async (payload: Record<string, unknown>) => {
    const normalizedPayload = normalizeCustomerCreatePayload(payload);
    return fetch("/api/encoder/customers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedPayload),
    });
  },

  uploadCustomerKycDocument: (
    customerId: string | number,
    payload: FormData,
  ) =>
    fetch(
      `/api/encoder/customer-documents?customerId=${encodeURIComponent(String(customerId))}`,
      {
        method: "POST",
        credentials: "include",
        body: payload,
      },
    ),

  createCustomerAccount: (payload: FormData) =>
    fetch("/api/encoder/users", {
      method: "POST",
      body: payload,
    }),

  // GET /api/v1/Account/GetProfile via the authenticated same-origin proxy.
  getProfile: () => fetch("/api/account/profile", { cache: "no-store" }),

  // PUT /api/v1/Account/UpdateProfile via the authenticated same-origin proxy.
  updateProfile: (profile: {
    firstName: string;
    lastName: string;
    phone: string;
    username: string;
    email: string;
    profilePhotoFile?: File;
  }) => {
    const { profilePhotoFile, ...fields } = profile;
    let body: FormData | URLSearchParams;
    if (profilePhotoFile) {
      body = new FormData();
      body.append("FirstName", fields.firstName);
      body.append("LastName", fields.lastName);
      body.append("Phone", fields.phone);
      body.append("Username", fields.username);
      body.append("Email", fields.email);
      body.append("ProfilePhotoFile", profilePhotoFile, profilePhotoFile.name);
    } else {
      body = new URLSearchParams({
        FirstName: fields.firstName,
        LastName: fields.lastName,
        Phone: fields.phone,
        Username: fields.username,
        Email: fields.email,
        ProfilePhotoFile: "",
      });
    }

    return fetch("/api/encoder/profile", {
      method: "PUT",
      body,
    });
  },

  // PUT /api/v1/DataEncoder/services/{id}/service-type
  updateServiceType: (
    id: number | string,
    payload: Record<string, unknown>
  ) =>
    fetch(`/api/encoder/services/${encodeURIComponent(String(id))}/service-type`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  // GET /api/v1/DataEncoder/services via the authenticated same-origin proxy.
  getServices: () => getProxyJson("/api/encoder/services", "Data Encoder services"),

  getServiceStages: (serviceId: string | number) =>
    getProxyJson(
      `/api/encoder/services/${encodeURIComponent(String(serviceId))}/stages`,
      "Service stages",
    ),

  // GET /api/v1/Document/GetServiceDocuments?serviceId={id}
  getServiceDocuments: (serviceId: number | string) =>
    getProxyJson(
      `/api/encoder/services/${encodeURIComponent(String(serviceId))}/documents`,
      "Service documents",
    ),

  uploadStageDocument: (payload: FormData) =>
    fetch("/api/encoder/documents", {
      method: "POST",
      credentials: "include",
      body: payload,
    }),

  // GET /api/v1/Document/DownloadDocument?documentId={id}
  downloadDocument: (documentId: number | string) =>
    service.get(API_ROUTES.document.downloadDocument, {
      params: { documentId },
      responseType: "blob",
    }),

  // POST /api/v1/Document/VerifyDocument
  verifyDocument: (payload: {
    documentId: number | string;
    isVerified: boolean;
    notes?: string;
    verificationNotes?: string;
    verifiedByUserId?: number | string;
  }) => service.post(API_ROUTES.document.verifyDocument, payload),
};