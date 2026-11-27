import { API_BASE } from "@/modules/api/routes";

const getBackendOrigin = (): string => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return "http://localhost:5254";
  }
};

export const resolveAssessorDocumentUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return new URL(value.trim(), `${getBackendOrigin()}/`).toString();
  } catch {
    return undefined;
  }
};
