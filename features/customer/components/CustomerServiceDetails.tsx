"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, FileText, LoaderCircle } from "lucide-react";
import { CustomerPageHeader } from "@/features/customer/components/CustomerPageHeader";

interface CustomerShipment {
  id: string;
  trackingNumber: string;
  description: string;
  mode: string;
  assignedHub: string;
  status: string;
  origin: string;
  destination: string;
  createdAt: string;
  updatedAt: string;
  inspectionType: string;
}

interface ShipmentStage {
  id: string;
  shipmentId: string;
  stageName: string;
  description: string;
  status: string;
  sequence: number;
  isBlocked: boolean;
  requiresCustomerAction: boolean;
}

interface ServiceDetailsData {
  shipment: CustomerShipment;
  stages: ShipmentStage[];
  stagesError: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (record: Record<string, unknown>, ...names: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    names.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const readText = (record: Record<string, unknown>, ...names: string[]): string => {
  const value = readField(record, ...names);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

const readBoolean = (record: Record<string, unknown>, name: string): boolean => {
  const value = readField(record, name);
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false" || value == null) return false;
  throw new Error(`The backend returned an invalid ${name} value.`);
};

const readRows = (value: unknown): Record<string, unknown>[] => {
  let candidate = value;
  for (let depth = 0; depth < 6; depth += 1) {
    if (Array.isArray(candidate)) {
      if (!candidate.every(isRecord)) {
        throw new Error("The backend returned an invalid service list.");
      }
      return candidate;
    }
    if (!isRecord(candidate)) break;
    candidate =
      candidate.data ??
      candidate.payload ??
      candidate.response ??
      candidate.result ??
      candidate.items ??
      candidate.records ??
      candidate.services ??
      candidate.myServices;
  }
  if (candidate == null) return [];
  throw new Error("The backend response did not contain a service list.");
};

const readJson = async (response: Response, description: string): Promise<unknown> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The ${description} endpoint returned an invalid response.`);
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : `Unable to load ${description} (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return body;
};

const mapShipment = (record: Record<string, unknown>): CustomerShipment => {
  const id = readText(record, "id", "shipmentId").trim();
  if (!id) throw new Error("The backend returned a service without an ID.");

  const rawStatus = readField(record, "status", "statusName");
  const statusLabels: Record<number, string> = {
    0: "Pending",
    1: "In progress",
    2: "Pending",
    3: "Needs review",
    4: "Completed",
  };
  const status = typeof rawStatus === "number" ||
    (typeof rawStatus === "string" && /^\d+$/.test(rawStatus))
    ? statusLabels[Number(rawStatus)] ?? String(rawStatus)
    : typeof rawStatus === "string" && rawStatus.trim()
      ? rawStatus
      : "Pending";

  return {
    id,
    trackingNumber: readText(record, "trackingNumber", "trackingId", "serviceNumber"),
    description: readText(record, "itemDescription", "description", "goodsDescription"),
    mode: readText(record, "mode", "serviceType") || "Not specified",
    assignedHub: readText(record, "assignedHub", "hub", "routeCategory") || "Not assigned",
    status,
    origin: readText(record, "origin", "originPort", "countryOfOrigin") || "Not specified",
    destination: readText(record, "destination") || "Not specified",
    createdAt: readText(record, "createAt", "createdAt", "registeredDate"),
    updatedAt: readText(record, "updatedAt", "lastUpdateDate"),
    inspectionType: readText(record, "inspectionType", "inspectionChannel"),
  };
};

const mapStage = (record: Record<string, unknown>): ShipmentStage => {
  const id = readText(record, "id", "serviceStageExecutionId").trim();
  if (!id) throw new Error("The backend returned a milestone without an ID.");

  const rawSequence = readField(record, "sequence", "stageOrder", "executionOrder", "order");
  const sequence = typeof rawSequence === "number" ? rawSequence : Number(rawSequence ?? 0);

  return {
    id,
    shipmentId: readText(record, "shipmentId", "shipmentID"),
    stageName: readText(record, "stageName", "serviceStageName", "stage", "name", "title") || "Service milestone",
    description: readText(record, "description", "notes", "comments", "blockReason"),
    status: readText(record, "status", "statusName") || "Pending",
    sequence: Number.isFinite(sequence) ? sequence : 0,
    isBlocked: readBoolean(record, "isBlocked"),
    requiresCustomerAction: readBoolean(record, "requiresCustomerAction"),
  };
};

const isComplete = (status: string) => /complete|done|delivered/i.test(status);

export default function CustomerServiceDetails({ serviceId }: { serviceId: string }) {
  const { lang = "en" } = useParams<{ lang: string }>();
  const [details, setDetails] = useState<ServiceDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const loadDetails = useCallback(async (signal: AbortSignal): Promise<ServiceDetailsData> => {
    if (!serviceId.trim() || serviceId.length > 128) {
      throw new Error("This service could not be found in your account.");
    }

    const shipmentsResponse = await fetch("/api/customer/shipments", {
      cache: "no-store",
      signal,
    });
    const shipments = readRows(await readJson(shipmentsResponse, "service list")).map(mapShipment);
    const shipment = shipments.find(
      (item) => item.id === serviceId || item.trackingNumber === serviceId,
    );
    if (!shipment) {
      throw new Error("This service could not be found in your account.");
    }

    let stages: ShipmentStage[] = [];
    let stagesError: string | null = null;
    try {
      const stagesResponse = await fetch(
        `/api/customer/stages?shipmentIds=${encodeURIComponent(shipment.id)}`,
        { cache: "no-store", signal },
      );
      stages = readRows(await readJson(stagesResponse, "service milestones"))
        .map(mapStage)
        .filter((stage) => !stage.shipmentId || stage.shipmentId === shipment.id)
        .sort((a, b) => a.sequence - b.sequence);
    } catch (loadError: unknown) {
      if (signal.aborted) throw loadError;
      stagesError = loadError instanceof Error
        ? loadError.message
        : "Unable to load service milestones.";
    }

    return { shipment, stages, stagesError };
  }, [serviceId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDetails(controller.signal)
      .then((loadedDetails) => {
        if (controller.signal.aborted) return;
        setDetails(loadedDetails);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setDetails(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load this service.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadDetails, retry]);

  const retryLoading = () => {
    setLoading(true);
    setError(null);
    setRetry((current) => current + 1);
  };

  const completedCount = details?.stages.filter((stage) => isComplete(stage.status)).length ?? 0;
  const progress = details?.stages.length
    ? Math.round((completedCount / details.stages.length) * 100)
    : null;

  return (
    <>
      <CustomerPageHeader
        eyebrow="Service details"
        title={details?.shipment.trackingNumber || "Service details"}
        description="Review the service status, consignment information, and live workflow milestones."
      />
      <main className="mx-auto max-w-[1100px] space-y-5 p-5 sm:p-7">
        <Link
          href={`/${lang}/customer/services?view=shipments`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to services
        </Link>

        {loading && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading service details…
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <button
              type="button"
              onClick={retryLoading}
              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && details && (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs font-semibold text-slate-500">
                    Service ID: {details.shipment.id}
                  </p>
                  {details.shipment.description && (
                    <h2 className="mt-2 text-lg font-bold text-slate-950">
                      {details.shipment.description}
                    </h2>
                  )}
                  <p className="mt-2 text-sm text-slate-600">
                    {details.shipment.origin} <span aria-hidden>→</span> {details.shipment.destination}
                  </p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">
                  {details.shipment.status}
                </span>
              </div>

              <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Transport mode", details.shipment.mode],
                  ["Assigned hub", details.shipment.assignedHub],
                  ["Inspection channel", details.shipment.inspectionType || "Not assigned"],
                  ["Last updated", details.shipment.updatedAt || details.shipment.createdAt || "Not available"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                <Link
                  href={`/${lang}/customer/documents`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="h-4 w-4" />
                  View documents
                </Link>
                <Link
                  href={`/${lang}/customer/dashboard?view=tax-records`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View tax records
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</p>
                  <h2 className="mt-1 text-lg font-bold text-slate-950">Service milestones</h2>
                </div>
                {progress !== null && (
                  <span className="text-sm font-semibold text-slate-700">
                    {completedCount} of {details.stages.length} complete · {progress}%
                  </span>
                )}
              </div>

              {details.stagesError && (
                <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Milestone details are unavailable: {details.stagesError}
                </p>
              )}
              {!details.stagesError && details.stages.length === 0 && (
                <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  No milestones have been recorded for this service.
                </p>
              )}
              {details.stages.length > 0 && (
                <ol className="mt-5 space-y-3">
                  {details.stages.map((stage, index) => {
                    const complete = isComplete(stage.status);
                    const needsAction = stage.isBlocked || stage.requiresCustomerAction;
                    return (
                      <li key={stage.id} className="flex items-start gap-3">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          needsAction
                            ? "bg-amber-100 text-amber-800"
                            : complete
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                        }`}>
                          {complete && !needsAction
                            ? <CheckCircle2 className="h-4 w-4" />
                            : String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1 border-b border-slate-100 pb-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">{stage.stageName}</p>
                            <span className={`text-xs font-medium ${needsAction ? "text-amber-800" : "text-slate-500"}`}>
                              {stage.isBlocked ? "Blocked" : stage.requiresCustomerAction ? "Customer action required" : stage.status}
                            </span>
                          </div>
                          {stage.description && (
                            <p className="mt-1 text-xs text-slate-600">{stage.description}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
