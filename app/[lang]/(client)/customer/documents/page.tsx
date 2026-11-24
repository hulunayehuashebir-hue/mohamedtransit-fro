"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, FileUp, LoaderCircle } from "lucide-react";
import { CustomerPageHeader } from "@/features/customer/components/CustomerPageHeader";
import { uploadCustomerStageDocument } from "@/modules/customer/customer.endpoint";

interface CustomerService {
  id: string;
  label: string;
}

interface CustomerStage {
  id: string;
  serviceId: string;
  label: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (record: Record<string, unknown>, ...names: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    names.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const extractRows = (value: unknown): Record<string, unknown>[] => {
  let candidate = value;
  for (let depth = 0; depth < 6; depth += 1) {
    if (Array.isArray(candidate)) {
      if (!candidate.every(isRecord)) throw new Error("The backend returned an invalid list.");
      return candidate;
    }
    if (!isRecord(candidate)) break;
    candidate =
      readField(candidate, "data") ??
      readField(candidate, "payload") ??
      readField(candidate, "response") ??
      readField(candidate, "result") ??
      readField(candidate, "items") ??
      readField(candidate, "services") ??
      readField(candidate, "stages");
  }
  if (candidate === null || candidate === undefined) return [];
  throw new Error("The backend response did not contain a list.");
};

const readId = (record: Record<string, unknown>, ...fields: string[]): string => {
  const value = readField(record, ...fields);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
};

export default function CustomerDocumentsPage() {
  const [services, setServices] = useState<CustomerService[]>([]);
  const [stages, setStages] = useState<CustomerStage[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [stageId, setStageId] = useState("");
  const [documentType, setDocumentType] = useState("Bill of Lading");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/customer/shipments", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readError(response, "Unable to load your services."));
        const records = extractRows(await response.json());
        const nextServices = records.flatMap((record) => {
          const id = readId(record, "id", "serviceId", "shipmentId");
          if (!id) return [];
          return [{
            id,
            label: readId(record, "serviceNumber", "trackingNumber", "trackingId") || `Service ${id}`,
          }];
        });
        setServices(nextServices);
        setServiceId(nextServices[0]?.id ?? "");
        setError(null);
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load your services.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!serviceId) return;
    const controller = new AbortController();
    const loadStages = async () => {
      try {
        const response = await fetch(
          `/api/customer/stages?shipmentIds=${encodeURIComponent(serviceId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(await readError(response, "Unable to load service stages."));
        const records = extractRows(await response.json());
        const nextStages = records.flatMap((record) => {
          const id = readId(record, "id", "serviceStageExecutionId", "stageId");
          if (!id) return [];
          return [{
            id,
            serviceId: readId(record, "shipmentId", "serviceId", "shipmentID") || serviceId,
            label: readId(record, "stageName", "serviceStageName", "name", "title") || `Stage ${id}`,
          }];
        }).filter((stage) => stage.serviceId === serviceId);
        setStages(nextStages);
        setStageId(nextStages[0]?.id ?? "");
      } catch (stageError: unknown) {
        if (controller.signal.aborted) return;
        setStages([]);
        setError(stageError instanceof Error ? stageError.message : "Unable to load service stages.");
      }
    };
    void loadStages();
    return () => controller.abort();
  }, [serviceId]);

  const availableStages = useMemo(
    () => stages.filter((stage) => stage.serviceId === serviceId),
    [serviceId, stages],
  );

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (!file || !availableStages.some((stage) => stage.id === stageId)) {
      setError("Select a service stage and a document to upload.");
      return;
    }
    const payload = new FormData();
    payload.append("File", file, file.name);
    payload.append("ServiceId", serviceId);
    payload.append("ServiceStageId", stageId);
    payload.append("DocumentType", "10");
    payload.append("Description", documentType);

    setUploading(true);
    try {
      await uploadCustomerStageDocument(payload);
      setSuccess(true);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload this document.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <CustomerPageHeader
        eyebrow="Records"
        title="Document upload"
        description="Attach clearance documents to the service stage that requires them."
      />
      <main className="mx-auto max-w-[900px] space-y-5 p-5 sm:p-7">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        )}
        {success && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />Document uploaded successfully.
          </div>
        )}
        <form onSubmit={submitUpload} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Service
              <select required value={serviceId} disabled={loading || !services.length} onChange={(event) => setServiceId(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                {!services.length && <option value="">{loading ? "Loading services…" : "No services available"}</option>}
                {services.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Service stage
              <select required value={stageId} disabled={!availableStages.length} onChange={(event) => setStageId(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                {!availableStages.length && <option value="">No stages available</option>}
                {availableStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Document type
              <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                {["Bill of Lading", "Commercial Invoice", "Packing List", "Import License", "Other"].map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              File
              <input id="customer-stage-document" ref={fileInput} required type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" />
            </label>
          </div>
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button type="submit" disabled={uploading || loading || !availableStages.some((stage) => stage.id === stageId)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
              {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload document"}
            </button>
          </div>
        </form>
        {!loading && !services.length && !error && (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Create a service request before uploading stage documents.</p>
        )}
      </main>
    </>
  );
}
