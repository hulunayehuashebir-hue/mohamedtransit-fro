type ErrorRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ErrorRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readServerMessage = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;

  const errors = value.errors;
  if (Array.isArray(errors)) {
    const firstError = errors.find(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    );
    if (firstError) return firstError.trim();
  } else if (isRecord(errors)) {
    for (const fieldErrors of Object.values(errors)) {
      if (!Array.isArray(fieldErrors)) continue;
      const firstError = fieldErrors.find(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      );
      if (firstError) return firstError.trim();
    }
  }

  for (const key of ["message", "title", "detail"]) {
    const message = value[key];
    if (typeof message === "string" && message.trim()) return message.trim();
  }

  return undefined;
};

export const getAuthErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (!isRecord(error)) return undefined;

  const response = isRecord(error.response) ? error.response : undefined;
  const serverMessage = readServerMessage(response?.data) ?? readServerMessage(error);
  if (serverMessage) return serverMessage;

  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : undefined;
};

export const getAuthErrorStatus = (error: unknown): number | undefined => {
  if (typeof error === "string") {
    const status = error.match(/\b([1-5]\d{2})\b/)?.[1];
    return status ? Number(status) : undefined;
  }
  if (!isRecord(error)) return undefined;

  const response = isRecord(error.response) ? error.response : undefined;
  const status = response?.status ?? error.status ?? error.statusCode;
  if (typeof status === "number") return status;
  if (typeof status === "string" && /^\d{3}$/.test(status)) {
    return Number(status);
  }
  return undefined;
};
