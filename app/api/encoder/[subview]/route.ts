import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeApiBaseUrl } from "@/modules/utils/axios/config";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeFlags = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeFlags);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key.toLowerCase() === "isverified" || key.toLowerCase() === "isrequired") {
        if (item === 1 || item === "1" || item === true) return [key, true];
        if (item === 0 || item === "0" || item === false || item == null) {
          return [key, false];
        }
      }
      return [key, normalizeFlags(item)];
    }),
  );
};

const safeUserFields = new Set([
  "statuscode",
  "error",
  "errors",
  "message",
  "response",
  "data",
  "payload",
  "result",
  "users",
  "userlist",
  "items",
  "records",
  "rows",
  "id",
  "userid",
  "username",
  "firstname",
  "givenname",
  "lastname",
  "surname",
  "email",
  "phone",
  "isaccountlocked",
  "islocked",
  "isactive",
  "isenabled",
  "accountstatus",
  "userstatus",
  "recordstatus",
  "roles",
  "userroles",
  "role",
  "rolename",
  "name",
  "displayname",
]);

const sanitizeUserData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeUserData);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => safeUserFields.has(key.toLowerCase()))
      .map(([key, nested]) => [key, sanitizeUserData(nested)]),
  );
};

const readAccessToken = async (request: Request): Promise<string | null> => {
  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearerToken) return bearerToken;

  const cookieStore = await cookies();
  return (
    cookieStore.get("accessToken")?.value ??
    cookieStore.get("transit-portal-accessToken")?.value ??
    cookieStore.get("MohamedTransit-portal-accessToken")?.value ??
    null
  );
};

const jsonResponse = (body: unknown, status: number) => {
  const headers = { "Cache-Control": "no-store" };
  if (status === 204 || status === 304) {
    return new Response(null, { status, headers });
  }
  return NextResponse.json(body, { status, headers });
};

const readJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

class UserProfileRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const readAuthenticatedUserId = (value: unknown, depth = 0): number | null => {
  if (depth > 8 || !isRecord(value)) return null;

  for (const key of ["userId", "id", "accountId", "sub"]) {
    const actualKey = Object.keys(value).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    const candidate = actualKey ? value[actualKey] : undefined;
    const normalized =
      typeof candidate === "number"
        ? String(candidate)
        : typeof candidate === "string"
          ? candidate.trim()
          : "";
    if (/^[1-9]\d*$/.test(normalized)) {
      const id = Number(normalized);
      if (Number.isSafeInteger(id)) return id;
    }
  }

  for (const key of ["data", "payload", "response", "result", "profile", "user", "account"]) {
    const actualKey = Object.keys(value).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    const nested = actualKey ? value[actualKey] : undefined;
    const id = readAuthenticatedUserId(nested, depth + 1);
    if (id !== null) return id;
  }

  return null;
};

const getDataEncoderUserId = async (
  backendUrl: string,
  accessToken: string,
): Promise<number> => {
  const configuredId = process.env.DATA_ENCODER_USER_ID?.trim();
  if (configuredId) {
    if (!/^[1-9]\d*$/.test(configuredId) || !Number.isSafeInteger(Number(configuredId))) {
      throw new Error("DATA_ENCODER_USER_ID must be a positive integer.");
    }
    return Number(configuredId);
  }

  const response = await fetch(`${backendUrl}/Account/GetProfile`, {
    headers: {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const profile = await readJsonBody(response);
  if (!response.ok) {
    throw new UserProfileRequestError(
      `Unable to identify the signed-in data encoder (status ${response.status}).`,
      response.status,
    );
  }

  const userId = readAuthenticatedUserId(profile);
  if (userId === null) {
    throw new Error("The signed-in account profile did not include a valid user ID.");
  }
  return userId;
};

type RouteContext = { params: Promise<{ subview: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { subview } = await params;
  const allowedViews = new Set(["customers", "dashboard", "users"]);
  if (!allowedViews.has(subview)) {
    return jsonResponse({ error: "Unknown encoder resource." }, 404);
  }

  const accessToken = await readAccessToken(request);
  if (!accessToken) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const backendUrl = normalizeApiBaseUrl(
    process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
  );
  const incomingUrl = new URL(request.url);
  let endpoint: string;

  if (subview === "dashboard") {
    endpoint = `${backendUrl}/DataEncoder/GetDashboard`;
  } else if (subview === "users") {
    endpoint = `${backendUrl}/User/GetAll`;
  } else {
    const recordStatus = incomingUrl.searchParams.get("recordStatus");
    if (!recordStatus?.trim()) {
      return jsonResponse(
        { error: "A recordStatus is required to load encoder customers." },
        400,
      );
    }
    endpoint = `${backendUrl}/DataEncoder/GetAllCustomers/${encodeURIComponent(
      recordStatus.trim(),
    )}`;
  }

  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJsonBody(response);
    return jsonResponse(
      normalizeFlags(subview === "users" ? sanitizeUserData(body) : body),
      response.status,
    );
  } catch (error: unknown) {
    console.error(`Data encoder ${subview} request failed:`, error);
    return jsonResponse(
      { error: `Unable to reach the backend for encoder ${subview}.` },
      502,
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { subview } = await params;
  if (
    subview !== "customers" &&
    subview !== "shipments" &&
    subview !== "users" &&
    subview !== "customer-documents"
  ) {
    return jsonResponse({ error: "Unknown encoder submission." }, 404);
  }

  const accessToken = await readAccessToken(request);
  if (!accessToken) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const backendUrl = normalizeApiBaseUrl(
    process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
  );

  if (subview === "customer-documents") {
    const customerId = new URL(request.url).searchParams.get("customerId")?.trim() ?? "";
    if (!/^[1-9]\d*$/.test(customerId) || !Number.isSafeInteger(Number(customerId))) {
      return jsonResponse({ error: "A valid customer ID is required." }, 400);
    }

    let submittedForm: FormData;
    try {
      submittedForm = await request.formData();
    } catch {
      return jsonResponse({ error: "A valid KYC document form is required." }, 400);
    }

    const file = submittedForm.get("file");
    const documentType = submittedForm.get("documentType");
    if (typeof file === "string" || !file || file.size === 0) {
      return jsonResponse({ error: "Choose a KYC document to upload." }, 400);
    }
    if (
      typeof documentType !== "string" ||
      !["Business License", "Import License", "TIN Certificate"].includes(documentType)
    ) {
      return jsonResponse({ error: "Choose a supported KYC document type." }, 400);
    }
    if (file.size > 25 * 1024 * 1024) {
      return jsonResponse({ error: "KYC documents must be 25 MB or smaller." }, 400);
    }

    const expiresAt = submittedForm.get("expiresAt");
    if (typeof expiresAt === "string" && expiresAt.trim()) {
      if (Number.isNaN(Date.parse(expiresAt))) {
        return jsonResponse({ error: "Enter a valid expiry date." }, 400);
      }
      submittedForm.set("expiresAt", new Date(expiresAt).toISOString());
    } else {
      submittedForm.delete("expiresAt");
    }

    try {
      const response = await fetch(
        `${backendUrl}/DataEncoder/customers/${customerId}/documents`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            Accept: "application/json",
          },
          body: submittedForm,
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        },
      );
      return jsonResponse(normalizeFlags(await readJsonBody(response)), response.status);
    } catch (error: unknown) {
      console.error("Data encoder KYC document upload failed:", error);
      return jsonResponse(
        { error: "Unable to reach the backend to upload the KYC document." },
        502,
      );
    }
  }

  if (subview === "users") {
    let submittedForm: FormData;
    try {
      submittedForm = await request.formData();
    } catch {
      return jsonResponse({ error: "A valid user form is required." }, 400);
    }

    const readText = (name: string): string => {
      const value = submittedForm.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const username = readText("Username");
    const firstName = readText("FirstName");
    const lastName = readText("LastName");
    const email = readText("Email");
    const phone = readText("Phone");
    const password = submittedForm.get("Password");
    const profileFile = submittedForm.get("ProfileFile");
    const roleId = Number(readText("Roles"));

    if (!username || !firstName || !lastName || !email || typeof password !== "string" || password.length < 8) {
      return jsonResponse(
        { error: "Username, first name, last name, valid email, and a password of at least 8 characters are required." },
        400,
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid user email address." }, 400);
    }
    if (!Number.isSafeInteger(roleId) || roleId <= 0) {
      return jsonResponse({ error: "Select a valid Customer or Importer role." }, 400);
    }
    if (!profileFile || typeof profileFile === "string" || profileFile.size === 0) {
      return jsonResponse({ error: "A profile photo is required. Choose a JPG, PNG, or WEBP image up to 5 MB." }, 400);
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(profileFile.type)) {
      return jsonResponse({ error: "The profile photo must be a JPG, PNG, or WEBP image." }, 400);
    }
    if (profileFile.size > 5 * 1024 * 1024) {
      return jsonResponse({ error: "The profile photo must be 5 MB or smaller." }, 400);
    }

    const payload = new FormData();
    payload.set("Username", username);
    payload.set("FirstName", firstName);
    payload.set("LastName", lastName);
    payload.set("Email", email);
    payload.set("Phone", phone);
    payload.set("Password", password);
    payload.set("IsSuperAdmin", "false");
    payload.set("Roles", String(roleId));
    payload.set("ProfileFile", profileFile, profileFile.name);

    try {
      const response = await fetch(`${backendUrl}/User/Create`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          Accept: "application/json",
        },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const body = await readJsonBody(response);
      return jsonResponse(normalizeFlags(sanitizeUserData(body)), response.status);
    } catch (error: unknown) {
      console.error("Data encoder user creation failed:", error);
      return jsonResponse(
        { error: "Unable to reach the backend to create the customer account." },
        502,
      );
    }
  }

  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return jsonResponse({ error: "A valid JSON request body is required." }, 400);
  }
  if (!isRecord(submitted)) {
    return jsonResponse({ error: "A request object is required." }, 400);
  }

  let endpoint: string;
  let payload: JsonRecord;
  if (subview === "customers") {
    const requiredFields = [
      "businessName",
      "tinNumber",
      "businessLicense",
      "businessAddress",
      "city",
      "state",
      "postalCode",
      "contactPerson",
      "contactPhone",
      "contactEmail",
      "businessType",
      "importLicense",
    ] as const;
    const values: JsonRecord = {};
    for (const key of requiredFields) {
      const value = submitted[key];
      if (typeof value !== "string" || !value.trim()) {
        return jsonResponse({ error: `${key} is required.` }, 400);
      }
      values[key] = value.trim();
    }
    if (
      typeof submitted.contactEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitted.contactEmail)
    ) {
      return jsonResponse({ error: "Enter a valid customer contact email." }, 400);
    }
    const submittedUserId = submitted.userId;
    const normalizedUserId =
      typeof submittedUserId === "string" ? submittedUserId.trim() : submittedUserId;
    const userId =
      typeof normalizedUserId === "number"
        ? normalizedUserId
        : typeof normalizedUserId === "string" && /^\d+$/.test(normalizedUserId)
          ? Number(normalizedUserId)
          : Number.NaN;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return jsonResponse(
        { error: "A valid customer user ID is required. Select or create an active Customer/Importer account." },
        400,
      );
    }
    values.userId = userId;
    const expiry = submitted.importLicenseExpiry;
    if (typeof expiry === "string" && expiry.trim()) {
      if (Number.isNaN(Date.parse(expiry))) {
        return jsonResponse({ error: "Import license expiry must be a valid date." }, 400);
      }
      values.importLicenseExpiry = new Date(expiry).toISOString();
    } else {
      values.importLicenseExpiry = null;
    }
    try {
      values.createdByDataEncoderId = await getDataEncoderUserId(backendUrl, accessToken);
    } catch (error: unknown) {
      console.error("Unable to identify the signed-in data encoder:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Unable to identify the signed-in data encoder." },
        error instanceof UserProfileRequestError ? error.status : 502,
      );
    }
    endpoint = `${backendUrl}/DataEncoder/CreateCustomer`;
    payload = values;
  } else {
    const customerId = Number(submitted.customerId);
    const declaredValue = Number(submitted.declaredValue);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return jsonResponse({ error: "Select a valid customer before creating a shipment." }, 400);
    }
    if (!Number.isFinite(declaredValue) || declaredValue < 0) {
      return jsonResponse({ error: "Declared value must be a non-negative amount." }, 400);
    }
    const serviceType = submitted.serviceType;
    if (serviceType !== "Multimodal" && serviceType !== "Unimodal") {
      return jsonResponse({ error: "Choose Multimodal or Unimodal service type." }, 400);
    }
    const itemDescription =
      typeof submitted.itemDescription === "string"
        ? submitted.itemDescription.trim()
        : "";
    const countryOfOrigin =
      typeof submitted.countryOfOrigin === "string"
        ? submitted.countryOfOrigin.trim()
        : "";
    const routeCategory =
      typeof submitted.routeCategory === "string"
        ? submitted.routeCategory.trim()
        : "";
    if (!itemDescription || !countryOfOrigin || !routeCategory) {
      return jsonResponse(
        { error: "Description, origin, and route category are required." },
        400,
      );
    }

    payload = {
      customerId,
      itemDescription,
      routeCategory,
      declaredValue,
      taxCategory:
        typeof submitted.taxCategory === "string" && submitted.taxCategory.trim()
          ? submitted.taxCategory.trim()
          : "General",
      countryOfOrigin,
      serviceType,
    };
    endpoint = `${normalizeApiBaseUrl(
      process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
    )}/Shipments/Create`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJsonBody(response);
    return jsonResponse(normalizeFlags(body), response.status);
  } catch (error: unknown) {
    console.error(`Data encoder ${subview} submission failed:`, error);
    return jsonResponse(
      { error: `Unable to reach the backend to create ${subview}.` },
      502,
    );
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { subview } = await params;
  if (subview !== "customers") {
    return jsonResponse({ error: "Unknown encoder update target." }, 404);
  }

  const accessToken = await readAccessToken(request);
  if (!accessToken) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return jsonResponse({ error: "A valid JSON request body is required." }, 400);
  }

  if (!isRecord(submitted)) {
    return jsonResponse({ error: "A request object is required." }, 400);
  }

  const customerId = Number(submitted.id ?? submitted.customerId ?? submitted.customerID);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return jsonResponse({ error: "A valid customer id is required." }, 400);
  }

  const requiredFields = [
    "businessName",
    "tinNumber",
    "businessLicense",
    "businessAddress",
    "city",
    "state",
    "postalCode",
    "contactPerson",
    "contactPhone",
    "contactEmail",
    "businessType",
    "importLicense",
  ] as const;

  const values: JsonRecord = { id: customerId };
  for (const key of requiredFields) {
    const value = submitted[key];
    if (typeof value !== "string" || !value.trim()) {
      return jsonResponse({ error: `${key} is required.` }, 400);
    }
    values[key] = value.trim();
  }

  if (
    typeof submitted.contactEmail !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitted.contactEmail)
  ) {
    return jsonResponse({ error: "Enter a valid customer contact email." }, 400);
  }

  const expiry = submitted.importLicenseExpiry;
  if (typeof expiry === "string" && expiry.trim()) {
    if (Number.isNaN(Date.parse(expiry))) {
      return jsonResponse({ error: "Import license expiry must be a valid date." }, 400);
    }
    values.importLicenseExpiry = new Date(expiry).toISOString();
  } else if (expiry === null || expiry === undefined) {
    values.importLicenseExpiry = null;
  }

  const endpoint = `${normalizeApiBaseUrl(
    process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
  )}/DataEncoder/UpdateCustomer`;

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJsonBody(response);
    return jsonResponse(normalizeFlags(body), response.status);
  } catch (error: unknown) {
    console.error(`Data encoder customer update failed:`, error);
    return jsonResponse(
      { error: "Unable to reach the backend to update the customer." },
      502,
    );
  }
}
