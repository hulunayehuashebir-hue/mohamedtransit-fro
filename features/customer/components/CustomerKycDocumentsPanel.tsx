"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, FileText, FileUp, LoaderCircle } from "lucide-react";
import { uploadCustomerKycDocument } from "@/modules/customer/customer.endpoint";

type CustomerKycDocument = {
  id: string;
  name: string;
  documentType: string;
  expiresAt: string | null;
  status: string;
  isExpired: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (record: Record<string, unknown>, ...names: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    names.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const readText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

const unwrapDocuments = (value: unknown, depth = 0): Record<string, unknown>[] => {
  if (depth > 8 || !isRecord(value)) return [];

  const documents = readField(value, "documents", "customerDocuments", "kycDocuments");
  if (Array.isArray(documents)) return documents.filter(isRecord);

  const wrapper = readField(value, "data", "payload", "response", "result", "profile", "customer");
  return wrapper === undefined ? [] : unwrapDocuments(wrapper, depth + 1);
};

const parseResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const responseError = (body: unknown, fallback: string): string => {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!isRecord(body)) return fallback;
  for (const key of ["error", "message", "detail", "title"]) {
    const message = body[key];
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (Array.isArray(body.errors)) {
    const message = body.errors.find(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    );
    if (message) return message.trim();
  }
  return fallback;
};

export function CustomerKycDocumentsPanel({ isAm }: { isAm: boolean }) {
  const [documents, setDocuments] = useState<CustomerKycDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState("Business License");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const response = await fetch("/api/customer/profile", {
        cache: "no-store",
        credentials: "include",
      });
      const body = await parseResponse(response);
      if (!response.ok) {
        if (response.status === 404) {
          setDocuments([]);
          setDocumentsError(null);
          return;
        }
        throw new Error(responseError(body, `Unable to load KYC documents (${response.status}).`));
      }

      const nextDocuments = unwrapDocuments(body).map((record, index) => {
        const expiry = readText(readField(record, "expiryDate", "expiresAt"));
        const expiresAtDate = expiry ? new Date(expiry) : null;
        const isExpired =
          readField(record, "isExpired") === true ||
          Boolean(
            expiresAtDate &&
              !Number.isNaN(expiresAtDate.getTime()) &&
              expiry.slice(0, 10) < new Date().toISOString().slice(0, 10),
          );
        return {
          id: readText(readField(record, "id", "documentId", "customerDocumentId")) || `kyc-${index}`,
          name: readText(readField(record, "originalFileName", "fileName", "name")) || "KYC document",
          documentType: readText(readField(record, "documentType", "type")) || "KYC document",
          expiresAt: expiry || null,
          status: readText(readField(record, "verificationStatus", "status")) || "Pending",
          isExpired,
        };
      });
      setDocuments(nextDocuments);
      setDocumentsError(null);
    } catch (error: unknown) {
      setDocumentsError(
        error instanceof Error
          ? error.message
          : isAm
            ? "የKYC ሰነዶችን መጫን አልተቻለም።"
            : "Unable to load your KYC documents.",
      );
    } finally {
      setDocumentsLoading(false);
    }
  }, [isAm]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadError(null);
    setUploadSuccess(null);
    if (!file) {
      setUploadError(isAm ? "ለመጫን ፋይል ይምረጡ።" : "Choose a file to upload.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError(isAm ? "ፋይሉ ከ25 MB መብለጥ የለበትም።" : "The file must be 25 MB or smaller.");
      return;
    }
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      setUploadError(isAm ? "ትክክለኛ የማብቂያ ቀን ያስገቡ።" : "Enter a valid expiry date.");
      return;
    }
    if (expiresAt && expiresAt < new Date().toISOString().slice(0, 10)) {
      setUploadError(isAm ? "የማብቂያ ቀኑ ባለፈው ጊዜ መሆን የለበትም።" : "The expiry date cannot be in the past.");
      return;
    }

    const payload = new FormData();
    payload.set("file", file, file.name);
    payload.set("documentType", documentType);
    if (expiresAt) payload.set("expiresAt", expiresAt);

    setUploading(true);
    try {
      const response = await uploadCustomerKycDocument(payload);
      const body = await parseResponse(response);
      if (!response.ok || (isRecord(body) && (body.error === true || body.isError === true))) {
        throw new Error(
          responseError(
            body,
            isAm
              ? `ሰነዱን መጫን አልተሳካም (${response.status})።`
              : `KYC upload failed (${response.status}).`,
          ),
        );
      }

      setUploadSuccess(
        isAm ? `${documentType} በተሳካ ሁኔታ ተጭኗል።` : `${documentType} uploaded successfully.`,
      );
      setFile(null);
      setExpiresAt("");
      if (fileInput.current) fileInput.current.value = "";
      await loadDocuments();
    } catch (error: unknown) {
      setUploadError(
        error instanceof Error
          ? error.message
          : isAm
            ? "የKYC ሰነዱን መጫን አልተቻለም።"
            : "Unable to upload this KYC document.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {isAm ? "የKYC ሰነዶች" : "KYC documents"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {isAm
            ? "የንግድ ፈቃድ፣ የማስመጣት ፈቃድ ወይም TIN ሰርተፍኬት ይጫኑ።"
            : "Upload your Business License, Import License, or TIN Certificate."}
        </p>
      </div>

      {documentsError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{documentsError}</span>
          <button type="button" onClick={() => void loadDocuments()} className="ml-auto font-semibold underline">
            {isAm ? "እንደገና ሞክር" : "Retry"}
          </button>
        </div>
      )}
      {uploadError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />{uploadSuccess}
        </div>
      )}

      <form onSubmit={submitUpload} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          {isAm ? "የሰነድ አይነት" : "Document type"}
          <select
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option>Business License</option>
            <option>Import License</option>
            <option>TIN Certificate</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          {isAm ? "የማብቂያ ቀን (አማራጭ)" : "Expiry date (optional)"}
          <input
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
        </label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
          {isAm ? "ፋይል" : "File"}
          <input
            ref={fileInput}
            required
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-blue-700"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            {isAm ? "PDF, JPG ወይም PNG፤ እስከ 25 MB።" : "PDF, JPG, or PNG; up to 25 MB."}
          </span>
        </label>
        <div className="flex justify-end sm:col-span-2">
          <button
            type="submit"
            disabled={uploading || !file}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {uploading ? (isAm ? "በመጫን ላይ..." : "Uploading…") : (isAm ? "ሰነድ ጫን" : "Upload document")}
          </button>
        </div>
      </form>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {isAm ? "የተጫኑ ሰነዶች" : "Uploaded documents"}
        </h3>
        {documentsLoading ? (
          <p className="mt-2 text-sm text-slate-500">{isAm ? "እየተጫኑ ነው..." : "Loading documents…"}</p>
        ) : documents.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{document.name}</p>
                    <p className="text-xs text-slate-500">{document.documentType}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p className={document.isExpired ? "font-semibold text-rose-700" : ""}>
                    {document.expiresAt
                      ? `${isAm ? "ማብቂያ" : "Expires"}: ${new Date(document.expiresAt).toLocaleDateString()}`
                      : (isAm ? "የማብቂያ ቀን የለም" : "No expiry date")}
                  </p>
                  <p>{document.isExpired ? (isAm ? "ጊዜው አልፏል" : "Expired") : document.status}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
            {isAm ? "የKYC ሰነዶች አልተገኙም።" : "No KYC documents have been uploaded yet."}
          </p>
        )}
      </div>
    </section>
  );
}
