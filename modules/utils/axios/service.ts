import axios from "axios";
import type {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

import { config } from "./config";
import { getToken } from "../token";
import { deleteTokensClient, getTokenClient } from "../token/client-token.storage";

/* =========================================================
   API Response Type
========================================================= */

type ApiError = string | { code?: number; message?: string };

interface ApiResponse<T = unknown> {
  statusCode?: number;
  error?: boolean;
  isError?: boolean;
  errors?: ApiError[] | Record<string, string[]>;
  message?: string;
  detail?: string;
  title?: string;
  payload?: T | null;

  response?: {
    data: T | null;
  };
}

const getApiErrorMessage = (value?: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const data = value as ApiResponse;

  if (Array.isArray(data?.errors)) {
    const messages = data.errors
      .map((error) => typeof error === "string" ? error : error.message)
      .filter((message): message is string => Boolean(message?.trim()));

    if (messages.length) {
      return messages.join(", ");
    }
  } else if (data?.errors) {
    const messages = Object.entries(data.errors)
      .flatMap(([field, errors]) => errors.map((message) => `${field}: ${message}`));

    if (messages.length) {
      return messages.join(" | ");
    }
  }

  return data?.message?.trim() || data?.detail?.trim() || data?.title?.trim() || undefined;
};

const serializeDiagnostic = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const isPasswordResetRequest = (url?: string): boolean =>
  url?.split("?")[0].toLowerCase().endsWith("/password/resetpassword") ?? false;

/* =========================================================
   Axios Instance
========================================================= */

const service: AxiosInstance = axios.create({
  baseURL: config.base_url.base,
  timeout: config.request_timeout,

  headers: {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
});

/* =========================================================
   Request Interceptor
========================================================= */

service.interceptors.request.use(
  async (requestConfig: InternalAxiosRequestConfig) => {
    if (!requestConfig.headers.has("Authorization")) {
      let token = await getToken();
      if (!token) {
        token = getTokenClient();
      }

      if (token) {
        requestConfig.headers.Authorization = `Bearer ${token}`;
      }
    }

    if (requestConfig.data instanceof FormData) {
      delete requestConfig.headers["Content-Type"];
    }

    if (
      requestConfig.method?.toLowerCase() === "post" &&
      requestConfig.headers["Content-Type"] === "application/x-www-form-urlencoded" &&
      typeof requestConfig.data === "object" &&
      requestConfig.data !== null &&
      !(requestConfig.data instanceof FormData)
    ) {
      const params = new URLSearchParams();

      Object.keys(requestConfig.data).forEach((key) => {
        params.append(
          key,
          String((requestConfig.data as Record<string, unknown>)[key] ?? "")
        );
      });

      requestConfig.data = params;
    }

    if (process.env.NODE_ENV === "development") {
      const isServiceDocumentsRequest = requestConfig.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/document/getservicedocuments");
      const isManagerAssignmentRequest = requestConfig.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/manager/assignexecutor");
      const isStageUpdateRequest = requestConfig.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/shipments/updateservicestage");
      if (isManagerAssignmentRequest || isStageUpdateRequest) {
        const requestName = isManagerAssignmentRequest
          ? "Manager AssignExecutor"
          : "Shipment UpdateServiceStage";
        console.info(`➡️ ${requestName} request:`, serializeDiagnostic({
          name: requestName,
          method: requestConfig.method?.toUpperCase(),
          path: service.getUri(requestConfig),
          payload: requestConfig.data ?? null,
        }));
      } else {
        console.log(
          "➡️ API Request:",
          requestConfig.method?.toUpperCase(),
          isServiceDocumentsRequest
            ? service.getUri(requestConfig)
            : `${requestConfig.baseURL}${requestConfig.url}`
        );
      }
    }

    return requestConfig;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

/* =========================================================
   Response Interceptor
========================================================= */

service.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const data = response.data;

    if (process.env.NODE_ENV === "development") {
      console.log(
        "⬅️ API Response:",
        response.status,
        response.config.url,
        response.data
      );
    }

    if (data?.error || data?.isError) {
      return Promise.reject(getApiErrorMessage(data) || "The request failed.");
    }

    const isSuccessfulStatus = [200, 201, 202, 204].includes(response.status);

    if (isSuccessfulStatus || data?.statusCode === 200 || data?.statusCode === 201 || data?.statusCode === 204) {
      if (data?.response?.data !== undefined) {
        return data.response.data as unknown as AxiosResponse<ApiResponse>;
      }

      if (data?.payload !== undefined) {
        return data.payload as unknown as AxiosResponse<ApiResponse>;
      }

      return data as unknown as AxiosResponse<ApiResponse>;
    }

    if (response.status === 401 || data?.statusCode === 401) {
      if (!isPasswordResetRequest(response.config.url)) {
        redirectToLogin();
      }
      return Promise.reject("Unauthorized access");
    }

    return Promise.reject(data?.message || "Unexpected response format");
  },
  (error: AxiosError<ApiResponse>) => {
    let errorMessage = "An unexpected error occurred.";

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      const apiErrorMessage = getApiErrorMessage(data);
      if (status === 401) {
        if (!isPasswordResetRequest(error.config?.url)) {
          redirectToLogin();
        }
        return Promise.reject(apiErrorMessage || "Unauthorized access");
      }

      const requestPath = error.config
        ? service.getUri(error.config)
        : undefined;
      const isAssessorRequest = error.config?.url
        ?.split("?")[0]
        .toLowerCase()
        .startsWith("/assessor/");
      if (status === 403 && isAssessorRequest) {
        console.warn("Assessor API request denied:", {
          path: requestPath,
          status,
        });
        return Promise.reject(
          "Your account is not authorized to access Assessor services. Sign in with an account assigned the Assessor role.",
        );
      }

      const isServiceDocumentsRequest = error.config?.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/document/getservicedocuments");
      const isForgotPasswordRequest = error.config?.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/password/forgotpassword");
      const isManagerAssignmentRequest = error.config?.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/manager/assignexecutor");
      const isStageUpdateRequest = error.config?.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/shipments/updateservicestage");
      const isCustomerRegistrationRequest = error.config?.url
        ?.split("?")[0]
        .toLowerCase()
        .endsWith("/customer/register");

      if (isServiceDocumentsRequest) {
        console.warn("⚠️ Service documents API request failed:", {
          path: requestPath,
          status,
          response: data,
        });
      } else if (
        isForgotPasswordRequest &&
        status === 404 &&
        /account\s+(does\s+not\s+exist|not\s+found)/i.test(apiErrorMessage ?? "")
      ) {
        console.warn("Forgot-password request rejected: account not found.", {
          path: requestPath,
          status,
          message: apiErrorMessage,
        });
      } else if (isManagerAssignmentRequest) {
        console.error("❌ Manager AssignExecutor request failed:", serializeDiagnostic({
          path: requestPath,
          status,
          statusText: error.response.statusText,
          message: error.message,
          payload: error.config?.data ?? null,
          response: data ?? null,
        }));
      } else if (isStageUpdateRequest) {
        console.error("❌ Shipment UpdateServiceStage request failed:", serializeDiagnostic({
          path: requestPath,
          status,
          statusText: error.response.statusText,
          message: error.message,
          payload: error.config?.data ?? null,
          response: data ?? null,
        }));
      } else if (
        !(isCustomerRegistrationRequest && (status === 400 || status === 409))
      ) {
        console.error("❌ API Error Path:", error.config?.url);
        console.error("❌ API Error Status:", status, data);
      }

      if (
        status === 400 &&
        isServiceDocumentsRequest &&
        JSON.stringify(data).toLowerCase().includes("no document data")
      ) {
        return Promise.resolve([]);
      }

      if (apiErrorMessage) {
        errorMessage = apiErrorMessage;
      } else if (status === 404) {
        errorMessage = `Server Error: 404 Not Found (${error.config?.baseURL || ""}${error.config?.url || ""})`;
      } else {
        const errorData = data as { title?: string } | undefined;

        if (errorData?.title) {
          errorMessage = errorData.title;
        } else {
          errorMessage = `Server Error: ${status} ${error.response.statusText}`;
        }
      }
    } else if (error.request) {
      errorMessage = "No response from server. Check your network connection and API URL.";
    }

    return Promise.reject(errorMessage);
  }
);

/* =========================================================
   Redirect Helper
========================================================= */

function redirectToLogin() {
  if (typeof window === "undefined") {
    return;
  }

  const pathname = window.location.pathname;
  const segments = pathname.split("/").filter(Boolean);
  const currentLocale = segments[0] || "en";
  const isLoginPage = segments.includes("login");

  if (isLoginPage) {
    return;
  }

  const callbackUrl = `${window.location.pathname}${window.location.search}`;

  try {
    deleteTokensClient();
    localStorage.removeItem("token");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  } catch {
    // Ignore localStorage errors
  }

  // This redirect runs from a browser-only utility outside a React component,
  // so the framework rule is intentionally suppressed here.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/${currentLocale}/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

/* =========================================================
   Export
========================================================= */

export { service };
