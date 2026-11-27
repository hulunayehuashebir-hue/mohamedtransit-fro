"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  FileText,
  FileUp,
  LoaderCircle,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Send,
  XCircle,
} from "lucide-react";
import { AssessorEndpoints } from "@/modules/assessor/assessor.endpoint";
import { useAssessorStore } from "@/modules/assessor/assessor.store";
import { useServiceReviewStore } from "@/features/service-reviews/serviceReview.store";
import { AssessmentDecision } from "@/features/service-reviews/components/AssessmentDecision";
import { StageEvidence } from "@/features/service-reviews/components/StageEvidence";
import { useAuditStore } from "@/features/audit-logs/audit-logs-store";
import { getAssessorCopy } from "@/modules/assessor/assessor.copy";
import type {
  AssessorItem,
  AssessorServiceStage,
  AssessorStageDiscussion,
  ServiceStageDecisionAction,
} from "@/modules/assessor/assessor.type";
import type { EvidenceFile } from "@/features/service-reviews/serviceReview.types";

interface PageProps {
  params: Promise<{ lang: string; id: string }>;
}

type DetailTab = "stage" | "documents" | "discussion" | "consignment";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (record: Record<string, unknown>, ...keys: string[]): unknown => {
  const match = Object.keys(record).find((key) =>
    keys.some((candidate) => candidate.toLowerCase() === key.toLowerCase()),
  );
  return match ? record[match] : undefined;
};

const readText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

const stageDocumentTypes: Record<number, string> = {
  1: "Invoice",
  2: "Bank receipt",
  3: "Delivery order",
  4: "Inspection report",
  5: "Clearance document",
  6: "Transport license",
  7: "Arrival photo",
  8: "Store receipt",
  9: "Legal document",
  10: "Other",
};

const getStageEvidenceFiles = (stage: AssessorServiceStage | null): EvidenceFile[] => {
  if (!stage) return [];
  const rawDocuments = readField(stage.details ?? {}, "documents", "stageDocuments");
  if (!Array.isArray(rawDocuments)) return [];

  return rawDocuments.flatMap((value) => {
    if (!isRecord(value)) return [];
    const rawId = readField(value, "id", "documentId");
    const id = rawId === null || rawId === undefined ? "" : String(rawId).trim();
    if (!/^[1-9]\d*$/.test(id)) return [];
    const rawType = readField(value, "documentType", "type");
    const typeId = typeof rawType === "number" ? rawType : Number(rawType);
    const rawSubmittedAt = readField(value, "createAt", "createdAt", "createdDate");
    const rawSize = readField(value, "fileSizeBytes", "size");
    return [{
      id: `stage-${id}`,
      stageDocumentId: id,
      serviceStageId: String(stage.id),
      name: readText(readField(value, "originalFileName", "fileName", "name")) || "—",
      type: (stageDocumentTypes[typeId] ?? readText(rawType)) || "Document",
      source: "Stage" as const,
      description: readText(readField(value, "description")) || undefined,
      size: readText(rawSize) || undefined,
      mimeType: readText(readField(value, "mimeType")) || undefined,
      isRequired: readField(value, "isRequired") === true,
      isVerified: readField(value, "isVerified") === true,
      verificationNotes: readText(readField(value, "verificationNotes")) || undefined,
      submittedAt: typeof rawSubmittedAt === "string" ? rawSubmittedAt : undefined,
    }];
  });
};

const unwrapObject = (value: unknown): AssessorItem | null => {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isRecord(current)) return null;
    const wrapper = Object.entries(current).find(([key, entry]) =>
      ["data", "payload", "response", "result", "resultData", "service", "consignment"]
        .includes(key.toLowerCase()) &&
      isRecord(entry),
    );
    if (wrapper) {
      current = wrapper[1];
      continue;
    }
    return current;
  }
  return null;
};

const unwrapRecords = (value: unknown): AssessorItem[] => {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (Array.isArray(current)) {
      if (!current.every(isRecord)) {
        throw new Error("The assessor services response contains invalid records.");
      }
      return current;
    }
    if (!isRecord(current)) break;
    const list = Object.entries(current).find(([key, entry]) =>
      [
        "data",
        "payload",
        "response",
        "result",
        "resultData",
        "items",
        "services",
        "activeServices",
        "activeServiceList",
        "activeServiceRecords",
        "serviceList",
        "serviceRecords",
        "shipments",
        "servicesUnderOversight",
        "oversightServices",
        "underOversight",
        "records",
        "rows",
      ]
        .includes(key.toLowerCase()) &&
      (Array.isArray(entry) || isRecord(entry)),
    );
    if (list) {
      current = list[1];
      continue;
    }
    if (readField(current, "id", "serviceId", "trackingNumber")) return [current];
    break;
  }
  throw new Error("The assessor response did not contain a service list.");
};

const unwrapCollection = (value: unknown, collectionNames: string[]): AssessorItem[] => {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (Array.isArray(current)) {
      return current.filter(isRecord);
    }
    if (!isRecord(current)) return [];
    const collection = Object.entries(current).find(([key, entry]) =>
      collectionNames.some((name) => name.toLowerCase() === key.toLowerCase()) &&
      (Array.isArray(entry) || isRecord(entry)),
    );
    if (collection) {
      current = collection[1];
      continue;
    }
    const wrapper = Object.entries(current).find(([key, entry]) =>
      ["data", "payload", "response", "result", "resultData", "items", "records", "rows"]
        .includes(key.toLowerCase()) &&
      (Array.isArray(entry) || isRecord(entry)),
    );
    if (wrapper) {
      current = wrapper[1];
      continue;
    }
    if (readField(current, "id", "documentId", "activityId")) return [current];
    return [];
  }
  return [];
};

const display = (record: AssessorItem, ...keys: string[]): string => {
  const value = readField(record, ...keys);
  return value === null || value === undefined || value === "" ? "—" : readText(value) || "—";
};

const nested = (record: AssessorItem, ...keys: string[]): AssessorItem => {
  const value = readField(record, ...keys);
  return isRecord(value) ? value : {};
};

const formatPersonName = (value: unknown): string => {
  if (!isRecord(value)) return readText(value);
  const fullName = [
    readText(readField(value, "firstName")),
    readText(readField(value, "lastName")),
  ].filter(Boolean).join(" ");
  return fullName || readText(readField(value, "fullName", "name", "username"));
};

const statusStyles = (status: string): string => {
  const normalized = status.toLowerCase();
  if (normalized.includes("customer action")) {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  if (normalized.includes("block") || normalized.includes("reject")) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (normalized.includes("needs review") || normalized.includes("needsreview")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (normalized.includes("complete") || normalized.includes("approv") || normalized.includes("deliver")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized.includes("progress") || normalized.includes("review") || normalized.includes("submit")) {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
};

const formatStatus = (value: unknown): string => {
  if (isRecord(value)) return formatStatus(readField(value, "value", "id", "code", "name", "label", "status"));
  const labels: Record<number, string> = {
    1: "Draft",
    2: "Submitted",
    3: "Under review",
    4: "Approved",
    5: "In progress",
    6: "Completed",
    7: "Rejected",
    8: "Cancelled",
    9: "Delivered",
  };
  const numeric = Number(value);
  return Number.isInteger(numeric) && labels[numeric]
    ? labels[numeric]
    : readText(value) || "—";
};

const formatChannel = (value: unknown): string => {
  if (isRecord(value)) return formatChannel(readField(value, "value", "id", "code", "name", "label", "riskChannel"));
  const labels: Record<number, string> = {
    1: "Blue channel",
    2: "Green channel",
    3: "Yellow channel",
    4: "Red channel",
  };
  const numeric = Number(value);
  return Number.isInteger(numeric) && labels[numeric]
    ? labels[numeric]
    : readText(value) || "—";
};

const isRiskChannelValue = (
  value: string,
): value is "Green" | "Yellow" | "Blue" | "Red" =>
  value === "Green" || value === "Yellow" || value === "Blue" || value === "Red";

const formatMode = (value: unknown): string => {
  if (isRecord(value)) return formatMode(readField(value, "value", "id", "code", "name", "label", "mode"));
  const labels: Record<number, string> = { 1: "Multimodal", 2: "Unimodal" };
  const numeric = Number(value);
  if (Number.isInteger(numeric) && labels[numeric]) return labels[numeric];
  const normalized = readText(value).replace(/[\s_-]/g, "").toLowerCase();
  if (normalized === "multimodal" || normalized === "multimodalsearail") return "Multimodal";
  if (normalized === "unimodal" || normalized === "unimodalroad") return "Unimodal";
  return readText(value) || "—";
};

const MULTIMODAL_STAGE_NAMES = [
  "Prepayment Invoice",
  "Transit Permission",
  "Amendment",
  "Drop Risk",
  "Delivery Order",
  "Warehouse Status",
  "Inspection",
  "Assessment & Tax Payment",
  "Emergency / Spot",
  "Exit & Storage Payment",
  "Transportation",
  "Clearance",
];
const UNIMODAL_STAGE_NAMES = ["Local Permission", "Arrival", "Clearance Request"];

const makeWorkflowTemplate = (
  mode: string,
  service: AssessorItem | null,
): AssessorServiceStage[] => {
  const names = mode === "Unimodal" ? UNIMODAL_STAGE_NAMES : MULTIMODAL_STAGE_NAMES;
  const currentStageValue = service
    ? readField(service, "currentStage", "currentStageName", "activeStage", "activeStageName")
    : undefined;
  const currentStageRecord = isRecord(currentStageValue) ? currentStageValue : {};
  const currentStageName = readText(
    isRecord(currentStageValue)
      ? readField(currentStageValue, "name", "stageName", "title")
      : currentStageValue,
  ).replace(/[\s_-]/g, "").toLowerCase();
  const currentStageOrder = Number(
    readField(service ?? {}, "currentStageOrder", "currentStageNumber", "activeStageOrder") ??
      readField(currentStageRecord, "order", "stageOrder", "sequence", "stepNumber") ??
      currentStageValue,
  );
  const currentIndex = currentStageName
    ? names.findIndex((name) => name.replace(/[\s&/_-]/g, "").toLowerCase() === currentStageName)
    : Number.isInteger(currentStageOrder) && currentStageOrder > 0
      ? currentStageOrder - 1
      : -1;
  const serviceStatus = formatStatus(readField(service ?? {}, "status", "serviceStatus"));
  const serviceStatusDescribesStage = [
    "In progress",
    "Needs review",
    "Requires customer action",
    "Blocked",
    "Pending",
  ].includes(serviceStatus);
  const currentStatus = readField(currentStageRecord, "status", "stageStatus") ??
    readField(service ?? {}, "currentStageStatus", "activeStageStatus") ??
    (currentIndex >= 0 && serviceStatusDescribesStage ? serviceStatus : undefined);

  return names.map((name, index) => ({
    id: -(index + 1),
    name,
    status: index === currentIndex && readText(currentStatus)
      ? readText(currentStatus)
      : "Not started",
    details: {
      isWorkflowTemplate: true,
      isCurrentStage: index === currentIndex,
      hasRecordedStatus: index === currentIndex && Boolean(readText(currentStatus)),
    },
  }));
};

const getEmbeddedStages = (service: AssessorItem | null): AssessorServiceStage[] => {
  if (!service) return [];
  return unwrapCollection(
    readField(service, "stages", "serviceStages", "shipmentStages"),
    ["stages", "serviceStages", "shipmentStages", "items", "records", "rows"],
  ).flatMap((record) => {
    const rawId = readField(record, "id", "serviceStageId", "shipmentStageId", "stageId");
    const id = typeof rawId === "number" ? rawId : Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    const name = readText(readField(record, "stageName", "name", "title", "stage"));
    if (!name) return [];
    const rawStatus = readField(record, "status", "stageStatus", "currentStatus");
    return [{
      id,
      name,
      status: rawStatus === null || rawStatus === undefined ? null : readText(rawStatus),
      details: record,
    }];
  });
};

const formatStageName = (stage: AssessorServiceStage, mode = "Multimodal"): string => {
  if (stage.details?.isWorkflowTemplate === true) return stage.name;
  const enumNames: Record<string, string> = {
    prepaymentinvoice: "Prepayment Invoice",
    transitpermission: "Transit Permission",
    amendment: "Amendment",
    droprisk: "Drop Risk",
    deliveryorder: "Delivery Order",
    warehousestatus: "Warehouse Status",
    inspection: "Inspection",
    assessmentandtaxpayment: "Assessment & Tax Payment",
    emergency: "Emergency / Spot",
    exitandstoragepayment: "Exit & Storage Payment",
    transportation: "Transportation",
    localpermission: "Local Permission",
    arrival: "Arrival",
    clearance: "Clearance",
    clearancerequest: "Clearance Request",
  };
  const numeric = Number(stage.name);
  const names = mode === "Unimodal" ? UNIMODAL_STAGE_NAMES : MULTIMODAL_STAGE_NAMES;
  return Number.isInteger(numeric)
    ? (mode === "Unimodal" && numeric >= 12 && numeric <= 14
      ? names[numeric - 12]
      : names[numeric - 1]) ?? stage.name
    : (mode === "Unimodal" && stage.name.replace(/[\s_-]/g, "").toLowerCase() === "clearance"
      ? "Clearance Request"
      : enumNames[stage.name.replace(/[\s_-]/g, "").toLowerCase()] ?? stage.name);
};

const normalizeStageKey = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const formatStageStatus = (stage: AssessorServiceStage): string => {
  const labels: Record<number, string> = {
    1: "Not started",
    2: "Pending",
    3: "In progress",
    4: "Completed",
    5: "Blocked",
    6: "Needs review",
  };
  const details = stage.details ?? {};
  if (readField(details, "isBlocked") === true) return "Blocked";
  if (readField(details, "requiresCustomerAction") === true) return "Customer action";
  const numeric = Number(stage.status);
  if (Number.isInteger(numeric)) return labels[numeric] ?? stage.status ?? "—";
  const normalized = readText(stage.status).replace(/[\s_-]/g, "").toLowerCase();
  const enumLabels: Record<string, string> = {
    notstarted: "Not started",
    pending: "Pending",
    inprogress: "In progress",
    completed: "Completed",
    blocked: "Blocked",
    needsreview: "Needs review",
  };
  return enumLabels[normalized] ?? stage.status ?? "—";
};

const isActiveStage = (stage: AssessorServiceStage): boolean => {
  const status = formatStageStatus(stage).toLowerCase();
  const details = stage.details ?? {};
  return [
    "in progress",
    "under review",
    "needs review",
    "customer action",
    "blocked",
    "attention",
    "active",
  ].some((label) => status.includes(label)) ||
    readField(details, "isBlocked") === true ||
    readField(details, "requiresCustomerAction") === true;
};

const formatProductAmount = (value: unknown): string => {
  const labels: Record<number, string> = { 1: "Container", 2: "Ton" };
  const numeric = Number(value);
  return Number.isInteger(numeric) ? labels[numeric] ?? readText(value) : readText(value);
};

const formatDateTime = (value: unknown): string => {
  const text = readText(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? text
    : new Intl.DateTimeFormat("en", {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const formatEta = (value: unknown): string => {
  const text = readText(value);
  if (!text) return "—";
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? text
    : new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
};

const getServiceCode = (service: AssessorItem, databaseId: number | null): string => {
  const suppliedCode = readText(readField(
    service,
    "code",
    "serviceCode",
    "service_code",
    "serviceNumber",
    "trackingCode",
    "trackingNumber",
  ));
  if (/^SVC-\d{4}-\d+$/i.test(suppliedCode)) return suppliedCode.toUpperCase();
  const recordId = databaseId ?? Number(readField(service, "id", "serviceId", "shipmentId"));
  if (Number.isSafeInteger(recordId) && recordId > 0) {
    const createdAt = readText(readField(service, "createdAt", "createAt", "registeredAt"));
    const year = createdAt && !Number.isNaN(new Date(createdAt).getTime())
      ? new Date(createdAt).getUTCFullYear()
      : new Date().getUTCFullYear();
    return `SVC-${year}-${String(recordId).padStart(4, "0")}`;
  }
  return "—";
};

const channelDirective = (channel: string): string => {
  const normalized = channel.toLowerCase();
  if (normalized.includes("green")) return "Routine handling. Post-clearance audit may apply.";
  if (normalized.includes("yellow")) return "Documentary review required before release. Assessor sign-off is mandatory.";
  if (normalized.includes("blue")) return "Documentary verification is required before release.";
  if (normalized.includes("red")) return "Inspection and compliance review are required before release.";
  return "—";
};

const formatElapsed = (startValue: unknown, endValue: unknown): string => {
  const start = new Date(readText(startValue)).getTime();
  const end = new Date(readText(endValue)).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const hours = Math.floor((end - start) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
};

const formatRelativeAge = (value: unknown): string => {
  const timestamp = new Date(readText(value)).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const joinPresent = (...values: string[]): string =>
  values.filter((value) => value && value !== "—").join(" · ");

const getStageRequirements = (
  stage: AssessorServiceStage | null,
  stageFiles: EvidenceFile[],
  allFiles: EvidenceFile[] = stageFiles,
): Array<{ name: string; file?: EvidenceFile }> => {
  if (!stage) return [];
  const rawRequirements = readField(
    stage.details ?? {},
    "requiredDocuments",
    "requiredDocumentTypes",
    "requiredEvidence",
  );
  if (Array.isArray(rawRequirements)) {
    return rawRequirements.flatMap((requirement) => {
      const name = isRecord(requirement)
        ? readText(readField(requirement, "name", "documentName", "documentType", "title"))
        : readText(requirement);
      if (!name) return [];
      const file = [...stageFiles, ...allFiles].find((candidate) =>
        candidate.name.toLowerCase() === name.toLowerCase() ||
        candidate.type.toLowerCase() === name.toLowerCase(),
      );
      return [{ name, file }];
    });
  }
  return stageFiles
    .filter((file) => file.isRequired)
    .map((file) => ({ name: file.name, file }));
};

const channelStyles = (channel: string): string => {
  if (channel.toLowerCase().includes("red")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (channel.toLowerCase().includes("yellow")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (channel.toLowerCase().includes("green")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (channel.toLowerCase().includes("blue")) return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
};

const RiskChannelIcon = ({ channel, className }: { channel: string; className: string }) => {
  const normalized = channel.toLowerCase();
  const Icon = normalized.includes("green") || normalized.includes("blue")
    ? ShieldCheck
    : normalized.includes("red")
      ? ShieldX
      : ShieldAlert;
  return <Icon className={className} />;
};

function ServiceDiscussion({
  serviceId,
  stage,
  mode,
}: {
  serviceId: number;
  stage: AssessorServiceStage;
  mode: string;
}) {
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);
  const fetchDiscussions = useAssessorStore((state) => state.fetchStageDiscussions);
  const addDiscussion = useAssessorStore((state) => state.addStageDiscussion);
  const discussions = useAssessorStore(
    (state) => state.stageDiscussionsByKey[`${serviceId}:${stage.id}`] ?? [],
  );
  const loading = useAssessorStore((state) => state.stageDiscussionsLoading);
  const error = useAssessorStore((state) => state.stageDiscussionsError);
  const submitting = useAssessorStore((state) => state.stageDiscussionSubmitting);

  useEffect(() => {
    void fetchDiscussions(serviceId, stage.id).catch(() => undefined);
  }, [fetchDiscussions, serviceId, stage.id]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setFeedback(null);
    setFeedbackError(false);
    try {
      await addDiscussion({ serviceId, stageId: stage.id, comment: comment.trim() });
      setComment("");
      setFeedback("Comment posted.");
    } catch (submitError: unknown) {
      setFeedback(submitError instanceof Error ? submitError.message : "Unable to post the comment.");
      setFeedbackError(true);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Stage discussion</h3>
        <p className="mt-1 text-xs text-slate-500">
          Comments for {formatStageName(stage, mode)} on this service.
        </p>
      </div>
      {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      {loading ? (
        <p role="status" className="text-sm text-slate-500">Loading discussion…</p>
      ) : discussions.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 p-4 text-sm text-slate-500">
          No comments have been returned for this stage.
        </p>
      ) : (
        <ol className="max-h-96 space-y-2 overflow-y-auto">
          {discussions.map((item: AssessorStageDiscussion) => (
            <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">{item.author || "Assessor"}</span>
                {item.createdAt && (
                  <time className="text-[11px] text-slate-500">
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{item.comment}</p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={(event) => void submit(event)} className="space-y-3 border-t border-slate-100 pt-4">
        <label className="block text-xs font-medium text-slate-700">
          Add a comment
          <textarea
            required
            maxLength={2000}
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="mt-1 w-full resize-y rounded border border-slate-200 bg-white p-3 text-sm font-normal text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </label>
        {feedback && (
          <p role={feedbackError ? "alert" : "status"} className={`text-xs ${feedbackError ? "text-rose-700" : "text-emerald-700"}`}>
            {feedback}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!comment.trim() || submitting}
            className="inline-flex items-center gap-2 rounded bg-sky-800 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {submitting ? "Posting…" : "Post comment"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function AssessorServiceDetailPage({ params }: PageProps) {
  const { lang, id } = use(params);
  const copy = getAssessorCopy(lang).serviceReview;
  const serviceKey = id;
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [service, setService] = useState<AssessorItem | null>(null);
  const [consignment, setConsignment] = useState<AssessorItem | null>(null);
  const [activities, setActivities] = useState<AssessorItem[]>([]);
  const [tab, setTab] = useState<DetailTab>("stage");
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [stageDecisionNotes, setStageDecisionNotes] = useState("");
  const [stageDecisionPending, setStageDecisionPending] = useState<ServiceStageDecisionAction | null>(null);
  const [stageDecisionFeedback, setStageDecisionFeedback] = useState<string | null>(null);
  const [stageDecisionFeedbackError, setStageDecisionFeedbackError] = useState(false);
  const [selectedRiskChannel, setSelectedRiskChannel] = useState<
    "Green" | "Yellow" | "Blue" | "Red" | ""
  >("");
  const [riskChannelSaving, setRiskChannelSaving] = useState(false);
  const [riskChannelFeedback, setRiskChannelFeedback] = useState<string | null>(null);
  const [riskChannelFeedbackError, setRiskChannelFeedbackError] = useState(false);
  const [uploadingStageDocument, setUploadingStageDocument] = useState(false);
  const [stageUploadFeedback, setStageUploadFeedback] = useState<string | null>(null);
  const [stageUploadFeedbackError, setStageUploadFeedbackError] = useState(false);
  const stageFileInput = useRef<HTMLInputElement>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [stagesLoading, setStagesLoading] = useState(false);
  const fetchStages = useAssessorStore((state) => state.fetchServiceStages);
  const fetchStageDiscussions = useAssessorStore((state) => state.fetchStageDiscussions);
  const stagesByServiceId = useAssessorStore((state) => state.serviceStagesByServiceId);
  const stageDiscussionsByKey = useAssessorStore((state) => state.stageDiscussionsByKey);
  const fetchDocuments = useServiceReviewStore((state) => state.fetchServiceDocuments);
  const fetchReviewCases = useServiceReviewStore((state) => state.fetchCases);
  const updateRiskChannel = useAssessorStore((state) => state.updateRiskChannel);
  const fetchDashboard = useAssessorStore((state) => state.fetchDashboard);
  const fetchAssessmentLogs = useAuditStore((state) => state.fetchLogs);
  const serviceDocuments = useServiceReviewStore((state) =>
    serviceId ? state.serviceDocuments[String(serviceId)] : undefined,
  );
  const documentsLoading = useServiceReviewStore((state) => state.documentsLoading);
  const documentsError = useServiceReviewStore((state) => state.documentsError);
  const apiStages = useMemo(
    () => serviceId ? stagesByServiceId[String(serviceId)] ?? [] : [],
    [serviceId, stagesByServiceId],
  );
  const workflowMode = service
    ? formatMode(readField(service, "mode", "transportMode", "serviceType"))
    : "Multimodal";
  const stages = useMemo(() => {
    const workflowTemplate = makeWorkflowTemplate(workflowMode, service);
    const availableStages = apiStages.length ? apiStages : getEmbeddedStages(service);
    if (!availableStages.length) return workflowTemplate;

    const orderedStages = [...availableStages].sort((left, right) => {
      const leftOrder = Number(readField(left.details ?? {}, "order", "stageOrder", "sequence", "stepNumber"));
      const rightOrder = Number(readField(right.details ?? {}, "order", "stageOrder", "sequence", "stepNumber"));
      return Number.isFinite(leftOrder) && Number.isFinite(rightOrder)
        ? leftOrder - rightOrder
        : 0;
    });
    const stageByName = new Map<string, AssessorServiceStage>();
    orderedStages.forEach((stage, index) => {
      const key = normalizeStageKey(formatStageName(stage, workflowMode));
      const indexKey = normalizeStageKey(workflowTemplate[index]?.name ?? "");
      stageByName.set(key, stage);
      if (!stageByName.has(indexKey)) stageByName.set(indexKey, stage);
      const explicitOrder = Number(readField(stage.details ?? {}, "order", "stageOrder", "sequence", "stepNumber"));
      if (Number.isInteger(explicitOrder) && explicitOrder > 0) {
        const orderedName = workflowTemplate[explicitOrder - 1]?.name;
        if (orderedName) stageByName.set(normalizeStageKey(orderedName), stage);
      }
    });
    return workflowTemplate.map((fallbackStage) =>
      stageByName.get(normalizeStageKey(fallbackStage.name)) ?? fallbackStage,
    );
  }, [apiStages, service, workflowMode]);
  const selectedStage = stages.find((stage) => stage.id === selectedStageId) ??
    stages.find((stage) => stage.details?.isCurrentStage === true) ??
    stages[0] ??
    null;
  const customer = service ? nested(service, "customer", "customerProfile") : {};
  const importerUser = service ? nested(service, "importer", "importerUser", "importerProfile", "importerDetails") : {};
  const importer = { ...(service ?? {}), ...customer, ...importerUser };
  const importerBusinessName = display(importer, "businessName", "name", "companyName", "importerName", "importer_name");
  const importerName = [
    readText(readField(importer, "firstName")),
    readText(readField(importer, "lastName")),
  ].filter(Boolean).join(" ");
  const assignedStaff = service ? nested(service, "assignedStaff", "assigned_staff") : {};
  const serviceExecutor = service ? nested(service, "assignedCaseExecutor", "caseExecutor", "executor") : {};
  const serviceAssessor = service ? nested(service, "assignedAssessor", "assessor") : {};
  const executor = Object.keys(serviceExecutor).length ? serviceExecutor : nested(assignedStaff, "executor");
  const assessor = Object.keys(serviceAssessor).length ? serviceAssessor : nested(assignedStaff, "assessor");
  const consignor = useMemo(
    () => consignment ?? (service ? nested(service, "consignment", "consignmentDetails") : {}),
    [consignment, service],
  );
  const transports = useMemo(
    () => unwrapCollection(readField(consignor, "transports", "transportDetails"), ["transports", "items", "records", "rows"]),
    [consignor],
  );
  const assignedPeople = [
    { role: display(executor, "role", "jobTitle") === "—" ? "Case executor" : display(executor, "role", "jobTitle"), person: executor },
    { role: display(assessor, "role", "jobTitle") === "—" ? "Assessor" : display(assessor, "role", "jobTitle"), person: assessor },
  ];

  const loadService = useCallback(async () => {
    setPageLoading(true);
    setPageError(null);
    try {
      const rawPathId = (serviceKey ?? "").trim();
      let match: AssessorItem | null = null;
      let numericId = Number(rawPathId);

      if (!Number.isSafeInteger(numericId) || numericId <= 0) {
        const activeResponse = await AssessorEndpoints.getActiveServicesForRegister();
        const records = unwrapRecords(activeResponse);
        match = records.find((record) =>
          readText(readField(
            record,
            "trackingNumber",
            "serviceNumber",
            "serviceCode",
            "code",
            "referenceNumber",
            "reference_number",
          )).toLowerCase() === rawPathId.toLowerCase(),
        ) ?? null;
        numericId = Number(match ? readField(match, "id", "serviceId", "shipmentId") : NaN);
      }
      if (!Number.isSafeInteger(numericId) || numericId <= 0) {
        throw new Error(`Service ${rawPathId || "(missing ID)"} was not found in the assessor service register.`);
      }

      const detailResponse = await AssessorEndpoints.getServiceDetails(numericId);
      const detailResponseRecord = unwrapObject(detailResponse);
      if (!detailResponseRecord) throw new Error("The assessor service detail response did not contain a service record.");
      const detail = { ...(match ?? {}), ...detailResponseRecord };
      const warnings: string[] = [];
      const activityRecords = unwrapCollection(
        readField(detail, "recentActivity", "activities", "serviceActivities", "auditLogs"),
        ["activities", "items", "records", "rows"],
      );
      setServiceId(numericId);
      setService(detail);
      const currentRiskChannel = formatChannel(
        readField(detail, "managerRiskChannel", "risk_channel", "riskLevel", "riskChannel", "channel"),
      ).replace(/\s+channel$/i, "");
      setSelectedRiskChannel(isRiskChannelValue(currentRiskChannel) ? currentRiskChannel : "");
      setConsignment({
        ...detail,
        ...(unwrapObject(readField(detail, "consignment", "consignmentDetails")) ?? {}),
      });
      setActivities(activityRecords);
      setSelectedStageId(null);
      setPageLoading(false);
      setStagesLoading(true);
      const result = await Promise.allSettled([
        fetchStages(numericId),
        fetchDocuments(numericId),
      ]);
      setStagesLoading(false);
      if (result[0].status === "fulfilled") {
        const stageRecords = result[0].value.length ? result[0].value : getEmbeddedStages(detail);
        const activeStage = stageRecords.find((stage) => formatStageStatus(stage).toLowerCase().includes("needs review")) ??
          stageRecords.find((stage) => formatStageStatus(stage).toLowerCase().includes("progress")) ??
          stageRecords.find(isActiveStage) ??
          stageRecords[0];
        setSelectedStageId(activeStage?.id ?? null);
      } else {
        const stageError = result[0].reason;
        warnings.push(
          stageError instanceof Error
            ? `Showing the standard ${formatMode(readField(detail, "mode", "transportMode", "serviceType"))} workflow because stage data could not be loaded: ${stageError.message}`
            : "Showing the standard workflow because stage data could not be loaded.",
        );
      }
      setPageError(warnings.length ? warnings.join(" ") : null);
    } catch (error: unknown) {
      setPageError(error instanceof Error ? error.message : "Unable to load assessor service details.");
    } finally {
      setPageLoading(false);
    }
  }, [fetchDocuments, fetchStages, serviceKey]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadService(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadService]);

  const stageIndex = selectedStage ? stages.findIndex((stage) => stage.id === selectedStage.id) : -1;
  const previousStage = stageIndex > 0 ? stages[stageIndex - 1] : null;
  const completedStages = stages.filter((stage) =>
    formatStageStatus(stage).toLowerCase().includes("complete"),
  ).length;
  const completion = stages.length ? Math.round((completedStages / stages.length) * 100) : 0;
  const trackingNumber = service ? getServiceCode(service, serviceId) : "—";
  const serviceStatus = service
    ? formatStatus(readField(service, "status", "serviceStatus"))
    : "";
  const closedService = ["completed", "rejected", "cancelled", "delivered"].includes(
    serviceStatus.toLowerCase(),
  );
  const selectedStageStatus = selectedStage ? formatStageStatus(selectedStage).toLowerCase() : "";
  const canDecideStage = Boolean(
    serviceId &&
    selectedStage &&
    selectedStage.id > 0 &&
    selectedStage.details?.isWorkflowTemplate !== true &&
    !closedService &&
    selectedStageStatus !== "—" &&
    selectedStageStatus !== "not started" &&
    selectedStageStatus !== "completed",
  );
  const currentStageStatus = selectedStage ? formatStageStatus(selectedStage) : "";
  const stageStatusIsRecorded = selectedStage?.details?.isWorkflowTemplate !== true ||
    selectedStage.details.hasRecordedStatus === true;
  const headerStatus = stageStatusIsRecorded && currentStageStatus && currentStageStatus !== "—"
    ? currentStageStatus
    : serviceStatus;
  const secondaryReference = service
    ? display(service, "referenceNumber", "reference_number", "clientReference", "referenceNo", "secondaryReference", "serviceReference", "externalReference")
    : "—";
  const channel = service
    ? selectedRiskChannel
      ? `${selectedRiskChannel} channel`
      : formatChannel(readField(service, "managerRiskChannel", "risk_channel", "riskLevel", "riskChannel", "channel"))
    : "—";
  const mode = workflowMode;
  const serviceTitle = service
    ? display(service, "cargo_description", "cargoDescription", "description", "title", "goodsDescription")
    : "—";
  const origin = display(consignor, "origin", "originName", "loadingPort") !== "—"
    ? display(consignor, "origin", "originName", "loadingPort")
    : service ? display(service, "origin", "originName", "loadingPort") : "—";
  const destination = display(consignor, "destination", "destinationName", "deliveryLocation") !== "—"
    ? display(consignor, "destination", "destinationName", "deliveryLocation")
    : service ? display(service, "destination", "destinationName", "deliveryLocation") : "—";
  const transitPort = display(consignor, "transitPort", "transit_port", "transitLocation") !== "—"
    ? display(consignor, "transitPort", "transit_port", "transitLocation")
    : service ? display(service, "transitPort", "transit_port", "transitLocation") : "—";
  const routeSummary = service
    ? display(service, "route_summary", "routeSummary", "route")
    : "—";
  const routeLabel = routeSummary !== "—"
    ? routeSummary
    : joinPresent(origin, transitPort, destination).replace(/ · /g, " → ");
  const eta = formatEta(readField(service ?? {}, "eta", "estimatedArrival", "estimated_arrival", "expectedArrival", "arrivalDate"));
  const explicitTransportReference = display(consignor, "transportReference", "vesselAndVoyage", "vessel_voyage");
  const flightNumber = display(consignor, "flightNumber", "flight_number");
  const carrierName = display(consignor, "carrierName", "carrier", "airline");
  const vesselName = display(consignor, "vesselName", "vessel_name");
  const voyage = display(consignor, "voyage", "voyageNumber", "voyage_number");
  const logisticsTransport = explicitTransportReference !== "—"
    ? explicitTransportReference
    : vesselName !== "—"
      ? `${vesselName}${voyage !== "—" ? ` / Voy. ${voyage}` : ""}`
      : flightNumber !== "—" && carrierName !== "—"
        ? `${flightNumber} — ${carrierName}`
        : joinPresent(flightNumber, carrierName);
  const importerDisplayName = importerBusinessName !== "—"
    ? importerBusinessName
    : importerName || display(service ?? {}, "importerName", "importer_name") || "—";
  const documents: EvidenceFile[] = serviceDocuments ?? [];
  const linkedStageDocuments = selectedStage
    ? documents.filter((file) => file.serviceStageId === String(selectedStage.id))
    : [];
  const stageEvidenceFiles = getStageEvidenceFiles(selectedStage);
  const selectedStageDocuments = [...linkedStageDocuments, ...stageEvidenceFiles];
  const stageDocuments = selectedStageDocuments.length ? selectedStageDocuments : documents;
  const requiredDocuments = getStageRequirements(
    selectedStage,
    selectedStageDocuments,
    [...documents, ...stageEvidenceFiles],
  );
  const uploadStageDocument = async (file: File) => {
    const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "xlsx"]);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowedExtensions.has(extension)) {
      setStageUploadFeedback("Choose a PDF, JPG, PNG, or XLSX file.");
      setStageUploadFeedbackError(true);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStageUploadFeedback("The file must be 25 MB or smaller.");
      setStageUploadFeedbackError(true);
      return;
    }
    if (!serviceId || !selectedStage || selectedStage.id <= 0 ||
      selectedStage.details?.isWorkflowTemplate === true) {
      setStageUploadFeedback("A recorded workflow stage is required to upload a document.");
      setStageUploadFeedbackError(true);
      return;
    }

    const payload = new FormData();
    payload.append("File", file, file.name);
    payload.append("ServiceId", String(serviceId));
    payload.append("ServiceStageId", String(selectedStage.id));
    payload.append("DocumentType", "10");
    payload.append("Description", `Uploaded for ${formatStageName(selectedStage, mode)}`);
    setUploadingStageDocument(true);
    setStageUploadFeedback(null);
    setStageUploadFeedbackError(false);
    try {
      await AssessorEndpoints.uploadServiceDocument(payload);
      const refreshResults = await Promise.allSettled([
        fetchDocuments(serviceId),
        fetchStages(serviceId),
      ]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        setStageUploadFeedback(`${file.name} uploaded, but the latest stage data could not be refreshed.`);
        setStageUploadFeedbackError(true);
      } else {
        setStageUploadFeedback(`${file.name} uploaded successfully.`);
      }
      if (stageFileInput.current) stageFileInput.current.value = "";
    } catch (error: unknown) {
      setStageUploadFeedback(error instanceof Error ? error.message : "Unable to upload the stage document.");
      setStageUploadFeedbackError(true);
    } finally {
      setUploadingStageDocument(false);
    }
  };
  const handleStageFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) void uploadStageDocument(file);
  };
  const handleStageFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void uploadStageDocument(file);
  };
  const submitStageDecision = async (action: ServiceStageDecisionAction) => {
    if (!serviceId || !selectedStage) {
      setStageDecisionFeedback("Select a valid service stage before recording a decision.");
      setStageDecisionFeedbackError(true);
      return;
    }
    if (!canDecideStage) {
      setStageDecisionFeedback("Only started, incomplete stages on an active service can receive an assessor decision.");
      setStageDecisionFeedbackError(true);
      return;
    }
    if (action !== "Approve" && !stageDecisionNotes.trim()) {
      setStageDecisionFeedback("A reason is required when returning or rejecting a stage.");
      setStageDecisionFeedbackError(true);
      return;
    }

    setStageDecisionFeedback(null);
    setStageDecisionFeedbackError(false);
    setStageDecisionPending(action);
    try {
      await AssessorEndpoints.decideServiceStage({
        serviceId,
        stageId: selectedStage.id,
        action,
        notes: stageDecisionNotes.trim() || null,
      });
      const actionLabel = action === "Approve"
        ? "approved"
        : action === "ReturnToExecutor"
          ? "returned to the case executor"
          : "rejected";
      setStageDecisionFeedback(`Stage ${actionLabel}.`);
      setStageDecisionNotes("");

      const refreshResults = await Promise.allSettled([
        fetchStages(serviceId),
        fetchStageDiscussions(serviceId, selectedStage.id),
        fetchReviewCases(),
        fetchDashboard(),
        fetchAssessmentLogs(),
      ]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        setStageDecisionFeedback(`Stage ${actionLabel}, but some updated service data could not be refreshed.`);
      }
    } catch (error: unknown) {
      setStageDecisionFeedback(error instanceof Error ? error.message : "Unable to record the stage decision.");
      setStageDecisionFeedbackError(true);
    } finally {
      setStageDecisionPending(null);
    }
  };
  const submitRiskChannel = async (riskChannel: string) => {
    if (!isRiskChannelValue(riskChannel) || !serviceId) return;

    const previousChannel = selectedRiskChannel;
    setSelectedRiskChannel(riskChannel);
    setRiskChannelSaving(true);
    setRiskChannelFeedback(null);
    setRiskChannelFeedbackError(false);
    try {
      await updateRiskChannel({ shipmentId: serviceId, riskChannel });
      setService((current) =>
        current
          ? {
              ...current,
              managerRiskChannel: riskChannel,
              riskChannel,
              riskLevel: riskChannel,
            }
          : current,
      );
      setRiskChannelFeedback(`${copy.riskChannelUpdated} ${riskChannel}.`);
      const refreshResults = await Promise.allSettled([
        fetchReviewCases(),
        fetchDashboard(),
        fetchAssessmentLogs(),
      ]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        setRiskChannelFeedback(`Risk channel updated to ${riskChannel}, but some dashboard data could not be refreshed.`);
      }
    } catch (error: unknown) {
      setSelectedRiskChannel(previousChannel);
      setRiskChannelFeedback(error instanceof Error ? error.message : "Unable to update the risk channel.");
      setRiskChannelFeedbackError(true);
    } finally {
      setRiskChannelSaving(false);
    }
  };
  const recentActivity = useMemo(() => {
    const stageEvents = stages.flatMap((stage) => {
      const details = stage.details ?? {};
      const timestamp = readField(
        details,
        "completedAt",
        "updatedAt",
        "modifiedAt",
        "createdAt",
        "createdDate",
        "startedAt",
        "activityDate",
        "eventDate",
      );
      if (!readText(timestamp)) return [];
      const activityDescription = readText(readField(details, "activity", "event", "description")) ||
        [
          `${formatStageName(stage, workflowMode)}: ${formatStageStatus(stage)}`,
          readText(readField(details, "notes", "comments", "blockReason")),
        ].filter(Boolean).join(" — ");
      const updatedBy = formatPersonName(readField(details, "updatedByUser", "completedBy", "updatedBy"));
      return [{
        id: `stage-${stage.id}`,
        description: [activityDescription, updatedBy ? `By ${updatedBy}` : ""].filter(Boolean).join(" · "),
        createdAt: timestamp,
      }];
    });
    return [...activities, ...stageEvents].sort((left, right) => {
      const leftTime = new Date(readText(readField(left, "createdAt", "createAt", "timestamp"))).getTime();
      const rightTime = new Date(readText(readField(right, "createdAt", "createAt", "timestamp"))).getTime();
      if (!Number.isFinite(leftTime)) return 1;
      if (!Number.isFinite(rightTime)) return -1;
      return rightTime - leftTime;
    });
  }, [activities, stages, workflowMode]);
  const stageDiscussions = selectedStage && serviceId
    ? stageDiscussionsByKey[`${serviceId}:${selectedStage.id}`] ?? []
    : [];
  const tabs: Array<{ id: DetailTab; label: string; count?: number }> = [
    { id: "stage", label: "Stage work" },
    { id: "documents", label: "Documents", count: stageDocuments.length },
    { id: "discussion", label: "Discussion", count: stageDiscussions.length },
    { id: "consignment", label: "Consignment" },
  ];
  const consignmentFields = useMemo(() => {
    const fields = [
      ["Commodity", ["commodity", "goodsDescription", "description"]],
      ["HS code", ["hsCode", "harmonizedSystemCode"]],
      ["Declared value", ["declaredValue", "invoiceValue"]],
      ["Currency", ["currency", "currencyCode"]],
      ["Incoterm", ["incoterm", "incoterms"]],
      ["Bill of lading", ["billOfLading", "billOfLadingNumber", "blNumber"]],
      ["Country of origin", ["countryOfOrigin", "originCountry"]],
      ["Route category", ["routeCategory"]],
      ["Assigned hub", ["assignedHub"]],
      ["Tax category", ["taxCategory"]],
      ["Transport mode", ["mode", "transportMode", "serviceType"]],
      ["Origin", ["origin", "originName", "loadingPort"]],
      ["Destination", ["destination", "destinationName", "deliveryLocation"]],
    ] as const;
    return fields.map(([label, keys]) => {
      const value = label === "Transport mode"
        ? formatMode(readField(consignor, ...keys))
        : display(consignor, ...keys);
      return [label, label === "Transport mode" && value === "—" ? mode : value] as const;
    });
  }, [consignor, mode]);

  if (pageLoading && !service) {
    return (
      <div role="status" className="mx-auto flex min-h-64 max-w-4xl items-center justify-center gap-2 text-sm text-slate-500">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading service details…
      </div>
    );
  }

  if (!service) {
    return (
      <main className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Link href={`/${lang}/admin/assessor/services`} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Back to services
        </Link>
        <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {pageError ?? "Service details are unavailable."}
        </p>
        <button type="button" onClick={() => void loadService()} className="mt-4 inline-flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1500px] space-y-5">
      <Link href={`/${lang}/admin/assessor/services`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Back to services
      </Link>

      {pageError && (
        <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {pageError}
        </p>
      )}

      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-bold text-slate-900">{trackingNumber}</h1>
              {secondaryReference !== "—" && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono text-xs text-slate-500">{secondaryReference}</span>
                </>
              )}
              {headerStatus && headerStatus !== "—" && (
                <span className={`rounded border px-2.5 py-1 text-xs font-medium ${statusStyles(headerStatus)}`}>{headerStatus}</span>
              )}
              {serviceStatus && serviceStatus !== "—" && serviceStatus !== headerStatus && (
                <span className={`rounded border px-2.5 py-1 text-xs font-medium ${statusStyles(serviceStatus)}`}>
                  Service {serviceStatus}
                </span>
              )}
              {channel !== "—" && (
                <span className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium ${channelStyles(channel)}`}>
                  <RiskChannelIcon channel={channel} className="h-3.5 w-3.5" /> {channel}
                </span>
              )}
              {mode !== "—" && (
                <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {mode}
                </span>
              )}
            </div>
            {serviceTitle !== "—" && <h2 className="mt-3 text-lg font-semibold text-slate-900">{serviceTitle}</h2>}
            {joinPresent(importerDisplayName, routeLabel, eta !== "—" ? `ETA ${eta}` : "") && (
              <p className="mt-1 text-sm text-slate-500">
                {joinPresent(importerDisplayName, routeLabel, eta !== "—" ? `ETA ${eta}` : "")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setTab("stage");
              window.setTimeout(() => {
                document.getElementById("assessment-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 0);
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded bg-sky-800 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-900"
          >
            <ClipboardCheck className="h-4 w-4" /> Record assessment
          </button>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Stage {Math.max(stageIndex + 1, 1)} of {stages.length}</span>
            <span>{completion}% complete</span>
          </div>
          <div
            role="progressbar"
            aria-label="Workflow completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion}
            className="flex h-2 gap-1"
          >
            {stages.map((stage) => {
              const status = formatStageStatus(stage).toLowerCase();
              const needsReview = status.includes("needs review") || status.includes("needsreview");
              const segmentColor = status.includes("complete")
                ? "bg-emerald-600"
                : needsReview
                  ? "bg-amber-500"
                  : status.includes("progress") || status.includes("review")
                    ? "bg-blue-500"
                    : "bg-slate-200";
              return <span key={stage.id} className={`h-full min-w-0 flex-1 rounded-full ${segmentColor}`} />;
            })}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {mode} workflow
          </p>
          {stagesLoading ? (
            <p role="status" className="text-sm text-slate-500">Loading stages…</p>
          ) : (
            <ol className="space-y-2">
              {stages.map((stage, index) => {
                const selected = selectedStage?.id === stage.id;
                const stageStatus = formatStageStatus(stage);
                const complete = stageStatus.toLowerCase().includes("complete");
                const customerAction = stageStatus.toLowerCase().includes("customer action");
                const needsReview = stageStatus.toLowerCase().includes("needs review");
                const active = isActiveStage(stage);
                return (
                  <li key={stage.id}>
                    <button
                      type="button"
                      aria-current={selected ? "step" : undefined}
                      onClick={() => {
                        setSelectedStageId(stage.id);
                        setStageDecisionFeedback(null);
                        setStageDecisionFeedbackError(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selected ? customerAction
                          ? "border-violet-200 bg-violet-50/70"
                          : "border-blue-200 bg-blue-50/70"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        complete ? "bg-emerald-100 text-emerald-700" : needsReview
                          ? "bg-amber-100 text-amber-700"
                          : selected
                          ? customerAction ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-500"
                      }`}>
                        {complete
                          ? <Check className="h-4 w-4" />
                          : active
                            ? <Search className="h-4 w-4" />
                            : <CircleDashed className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 truncate text-xs font-semibold text-slate-800">
                          <span className="font-mono text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                          {formatStageName(stage, mode)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">{stageStatus}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>

        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-500">Stage workspace</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">{selectedStage ? formatStageName(selectedStage, mode) : "Workflow stage"}</h2>
              {selectedStage && formatStageStatus(selectedStage) !== "—" && (
                <span className={`rounded border px-2.5 py-1 text-xs font-medium ${statusStyles(formatStageStatus(selectedStage))}`}>
                  {formatStageStatus(selectedStage)}
                </span>
              )}
            </div>
          </div>
          <div role="tablist" aria-label="Service details" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4">
            {tabs.map((item) => (
              <button
                key={item.id}
                id={`service-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`service-panel-${item.id}`}
                onClick={() => setTab(item.id)}
                className={`shrink-0 border-b-2 px-3 py-3 text-xs font-semibold transition-colors ${
                  tab === item.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {item.label}{item.count !== undefined ? ` (${item.count})` : ""}
              </button>
            ))}
          </div>
          <div
            id={`service-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`service-tab-${tab}`}
            className="space-y-5 p-5"
          >
            {tab === "stage" && (
              <>
                {selectedStage ? (
                  <div className="space-y-5">
                    <section className={`rounded-lg border p-4 ${statusStyles(formatStageStatus(selectedStage))}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Current workflow stage</p>
                          <h3 className="mt-1 text-sm font-bold">{formatStageName(selectedStage, mode)}</h3>
                        </div>
                        <span className="rounded border border-current/20 bg-white/60 px-2 py-1 text-[11px] font-semibold">
                          {formatStageStatus(selectedStage)}
                        </span>
                      </div>
                      {readText(readField(
                        selectedStage.details ?? {},
                        "statusMessage",
                        "actionRequired",
                        "notes",
                        "description",
                      )) && (
                        <p className="mt-3 text-xs leading-5">
                          {readText(readField(
                            selectedStage.details ?? {},
                            "statusMessage",
                            "actionRequired",
                            "notes",
                            "description",
                          ))}
                        </p>
                      )}
                    </section>

                    <section className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous stage summary</p>
                          <h3 className="mt-1 text-sm font-bold text-slate-900">
                              {previousStage ? formatStageName(previousStage, mode) : "No previous stage"}
                          </h3>
                        </div>
                        {previousStage && formatStageStatus(previousStage) !== "—" && (
                          <span className={`rounded border px-2 py-1 text-[11px] font-medium ${statusStyles(formatStageStatus(previousStage))}`}>
                            {formatStageStatus(previousStage)}
                          </span>
                        )}
                      </div>
                      {previousStage ? (
                        <>
                          {readText(readField(
                            previousStage.details ?? {},
                            "summary",
                            "notes",
                            "description",
                            "assessorNotes",
                          )) && (
                            <>
                              <p className="mt-3 text-[11px] font-medium text-slate-500">Carried forward context</p>
                              <p className="mt-1 text-xs leading-5 text-slate-600">
                                {readText(readField(
                                  previousStage.details ?? {},
                                  "summary",
                                  "notes",
                                  "description",
                                  "assessorNotes",
                                ))}
                              </p>
                            </>
                          )}
                          {formatDateTime(readField(
                            previousStage.details ?? {},
                            "completedAt",
                            "completionDate",
                            "updatedAt",
                            "modifiedAt",
                          )) && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              Completed {formatDateTime(readField(
                                previousStage.details ?? {},
                                "completedAt",
                                "completionDate",
                                "updatedAt",
                                "modifiedAt",
                              ))}
                            </p>
                          )}
                          {formatElapsed(
                            readField(previousStage.details ?? {}, "startedAt", "startDate", "createdAt"),
                            readField(previousStage.details ?? {}, "completedAt", "completionDate"),
                          ) && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Duration {formatElapsed(
                                readField(previousStage.details ?? {}, "startedAt", "startDate", "createdAt"),
                                readField(previousStage.details ?? {}, "completedAt", "completionDate"),
                              )}
                            </p>
                          )}
                          {formatPersonName(readField(previousStage.details ?? {}, "completedBy", "assessorName", "updatedBy", "updatedByUser")) && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              By {formatPersonName(readField(previousStage.details ?? {}, "completedBy", "assessorName", "updatedBy", "updatedByUser"))}
                            </p>
                          )}
                          {!readText(readField(
                            previousStage.details ?? {},
                            "summary",
                            "notes",
                            "description",
                            "assessorNotes",
                            "completedAt",
                            "completionDate",
                            "updatedAt",
                            "modifiedAt",
                            "completedBy",
                            "assessorName",
                            "updatedBy",
                            "updatedByUser",
                          )) && !formatPersonName(readField(previousStage.details ?? {}, "updatedByUser")) && (
                            <p className="mt-3 text-xs text-slate-500">No carried-forward context was provided.</p>
                          )}
                        </>
                      ) : (
                        <p className="mt-3 text-xs text-slate-500">This is the first stage returned for this service.</p>
                      )}
                    </section>

                    <section className="rounded-lg border border-slate-200 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Required documents for this stage</p>
                          <h3 className="mt-1 text-sm font-bold text-slate-900">
                            {requiredDocuments.filter((item) => item.file).length} of {requiredDocuments.length} received
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab("documents")}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          View documents
                        </button>
                      </div>
                      {requiredDocuments.length ? (
                        <ul className="space-y-2">
                          {requiredDocuments.map(({ name, file }, index) => (
                            <li key={`${name}-${index}`} className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
                              <span className="truncate font-medium text-slate-700">{name}</span>
                              <span className={`shrink-0 font-semibold ${
                                file?.isVerified ? "text-emerald-700" : file ? "text-blue-700" : "text-amber-700"
                              }`}>
                                {file?.isVerified ? "Verified" : file ? "Received" : "Outstanding"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">No mandatory documents defined for this stage.</p>
                      )}
                      <input
                        ref={stageFileInput}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.xlsx"
                        onChange={handleStageFileSelection}
                        className="sr-only"
                        aria-label="Attach a stage document"
                        disabled={
                          uploadingStageDocument ||
                          !selectedStage ||
                          selectedStage.id <= 0 ||
                          selectedStage.details?.isWorkflowTemplate === true
                        }
                      />
                      <div
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handleStageFileDrop}
                        className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center"
                      >
                        <FileUp className="mx-auto h-5 w-5 text-slate-500" />
                        <p className="mt-2 text-xs font-medium text-slate-700">Attach stage documents</p>
                        <p className="mt-1 text-[11px] text-slate-500">PDF, JPG, PNG, or XLSX · up to 25 MB</p>
                        <button
                          type="button"
                          onClick={() => stageFileInput.current?.click()}
                          disabled={
                            uploadingStageDocument ||
                            !selectedStage ||
                            selectedStage.id <= 0 ||
                            selectedStage.details?.isWorkflowTemplate === true
                          }
                          className="mt-2 text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {uploadingStageDocument ? "Uploading…" : "Choose file"}
                        </button>
                        {stageUploadFeedback && (
                          <p
                            role={stageUploadFeedbackError ? "alert" : "status"}
                            className={`mt-2 text-xs ${stageUploadFeedbackError ? "text-rose-700" : "text-emerald-700"}`}
                          >
                            {stageUploadFeedback}
                          </p>
                        )}
                      </div>
                    </section>

                    <section className="space-y-3 rounded-lg border border-slate-200 p-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{copy.stageDecision}</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Decisions are saved to the service workflow. A reason is required to return or reject this stage.
                        </p>
                      </div>
                      <label className="block text-xs font-medium text-slate-700">
                        {copy.decisionNotes}
                        <textarea
                          maxLength={2000}
                          rows={3}
                          value={stageDecisionNotes}
                          onChange={(event) => setStageDecisionNotes(event.target.value)}
                          placeholder="Documentary findings or reason for returning or rejecting this stage."
                          disabled={!canDecideStage || stageDecisionPending !== null}
                          className="mt-1 w-full resize-y rounded border border-slate-200 bg-white p-3 text-sm font-normal text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50"
                        />
                      </label>
                      {!canDecideStage && (
                        <p role="status" className="text-xs text-amber-700">
                          {closedService
                            ? `This service is ${serviceStatus.toLowerCase()} and cannot receive stage decisions.`
                            : selectedStageStatus === "not started"
                              ? "This stage has not started and cannot receive a decision yet."
                              : "Stage decisions are unavailable until an active stage is selected."}
                        </p>
                      )}
                      {stageDecisionFeedback && (
                        <p
                          role={stageDecisionFeedbackError ? "alert" : "status"}
                          className={`text-xs ${stageDecisionFeedbackError ? "text-rose-700" : "text-emerald-700"}`}
                        >
                          {stageDecisionFeedback}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void submitStageDecision("Approve")}
                          disabled={!canDecideStage || stageDecisionPending !== null}
                          className="inline-flex items-center gap-2 rounded bg-sky-800 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stageDecisionPending === "Approve"
                            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            : <CheckCircle2 className="h-3.5 w-3.5" />}
                          {copy.approveStage}
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitStageDecision("ReturnToExecutor")}
                          disabled={!canDecideStage || stageDecisionPending !== null || !stageDecisionNotes.trim()}
                          className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stageDecisionPending === "ReturnToExecutor"
                            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            : <RotateCcw className="h-3.5 w-3.5" />}
                          {copy.requestChanges}
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitStageDecision("Reject")}
                          disabled={!canDecideStage || stageDecisionPending !== null || !stageDecisionNotes.trim()}
                          className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stageDecisionPending === "Reject"
                            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            : <XCircle className="h-3.5 w-3.5" />}
                          {copy.blockReject}
                        </button>
                      </div>
                    </section>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Select a stage to see its workspace.</p>
                )}
                {serviceId && (
                  <div id="assessment-decision">
                    <AssessmentDecision
                      key={`${serviceId}-${selectedStage?.id ?? "none"}`}
                      shipmentId={serviceId}
                      stageId={selectedStage && selectedStage.id > 0 && selectedStage.details?.isWorkflowTemplate !== true
                        ? selectedStage.id
                        : undefined}
                      assessmentEnabled={Boolean(
                        selectedStage &&
                        selectedStage.id > 0 &&
                        selectedStage.details?.isWorkflowTemplate !== true &&
                        !["—", "not started", "completed", "blocked"].includes(selectedStageStatus),
                      )}
                      showDiscussion={false}
                      serviceStatus={serviceStatus}
                    />
                  </div>
                )}
              </>
            )}
            {tab === "documents" && (
              <>
                {!linkedStageDocuments.length && documents.length > 0 && (
                  <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    These documents were returned for the service; the API did not associate them with the selected stage.
                  </p>
                )}
                <StageEvidence
                  files={stageDocuments}
                  loading={documentsLoading}
                  error={documentsError}
                  serviceId={serviceId}
                />
              </>
            )}
            {tab === "discussion" && (
              selectedStage && serviceId && selectedStage.id > 0 && selectedStage.details?.isWorkflowTemplate !== true
                ? <ServiceDiscussion serviceId={serviceId} stage={selectedStage} mode={mode} />
                : <p className="text-sm text-slate-500">Stage discussion is available after workflow data is returned for a selected stage.</p>
            )}
            {tab === "consignment" && (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Package className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-bold text-slate-900">Consignment details</h3>
                </div>
                {consignment ? (
                  <div className="space-y-6">
                    <dl className="grid gap-4 sm:grid-cols-2">
                      {consignmentFields.map(([label, value]) => (
                        <div key={label} className="border-b border-slate-100 pb-2">
                          <dt className="text-xs text-slate-500">{label}</dt>
                          <dd className="mt-1 break-words text-sm font-medium text-slate-800">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transport records</h4>
                      {transports.length ? (
                        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                          {transports.map((transport, index) => {
                            const transportStage = stages.find(
                              (stage) => String(stage.id) === readText(readField(transport, "serviceStageId")),
                            );
                            return (
                              <li
                                key={readText(readField(transport, "id", "transportId")) || `transport-${index}`}
                                className="rounded-lg border border-slate-200 p-3"
                              >
                                <p className="text-sm font-semibold text-slate-800">
                                  {display(transport, "fullName", "driverName", "name")}
                                </p>
                                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                  <div>
                                    <dt className="text-slate-500">Plate number</dt>
                                    <dd className="mt-0.5 font-medium text-slate-700">{display(transport, "plateNumber", "vehiclePlate")}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-slate-500">Phone</dt>
                                    <dd className="mt-0.5 font-medium text-slate-700">{display(transport, "phoneNumber", "phone")}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-slate-500">Product amount</dt>
                                    <dd className="mt-0.5 font-medium text-slate-700">{formatProductAmount(readField(transport, "productAmount")) || "—"}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-slate-500">Workflow stage</dt>
                                    <dd className="mt-0.5 font-medium text-slate-700">
                                      {transportStage ? formatStageName(transportStage, mode) : "—"}
                                    </dd>
                                  </div>
                                </dl>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">No transport records were returned for this consignment.</p>
                      )}
                    </section>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    Consignment details were not returned with the service record.
                  </p>
                )}
              </section>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Importer</p>
            <p className="mt-2 text-sm font-bold text-slate-900">
              {importerBusinessName !== "—" ? importerBusinessName : importerName || "—"}
            </p>
            {joinPresent(
              display(importer, "customerCode", "customer_code", "importerCode", "code"),
              display(importer, "tinNumber", "tin_number", "tin") !== "—"
                ? `TIN ${display(importer, "tinNumber", "tin_number", "tin")}`
                : "",
            ) && (
              <p className="mt-1 text-xs text-slate-500">
                {joinPresent(
                  display(importer, "customerCode", "customer_code", "importerCode", "code"),
                  display(importer, "tinNumber", "tin_number", "tin") !== "—"
                    ? `TIN ${display(importer, "tinNumber", "tin_number", "tin")}`
                    : "",
                )}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-600">
              {joinPresent(
                display(importer, "contactPerson", "contact_person", "primaryContact", "firstName"),
                display(importer, "contactPhone", "contact_phone", "phone", "contactNumber"),
              )}
            </p>
            {display(importer, "contactEmail", "contact_email", "email") !== "—" && (
              <p className="mt-1 break-all text-xs text-slate-500">{display(importer, "contactEmail", "contact_email", "email")}</p>
            )}
            {display(importer, "businessAddress", "address") !== "—" && (
              <p className="mt-1 text-xs text-slate-500">{display(importer, "businessAddress", "address")}</p>
            )}
            <Link href={`/${lang}/admin/assessor/messages`} className="mt-3 inline-flex text-xs font-semibold text-blue-700 hover:underline">
              Message importer
            </Link>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned staff</p>
            {assignedPeople.map(({ role, person }) => (
              <div key={role} className="mt-3 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                  {formatPersonName(person).split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2) || "—"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">
                    {display(person, "fullName", "name", "username") === "—"
                      ? [display(person, "firstName"), display(person, "lastName")].filter((part) => part !== "—").join(" ") || "—"
                      : display(person, "fullName", "name", "username")}
                  </span>
                  <span className="text-[11px] text-slate-500">{role}</span>
                </span>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-slate-500" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{copy.riskCompliance}</p>
            </div>
            {channel !== "—" && (
              <span className={`mt-3 inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium ${channelStyles(channel)}`}>
                <RiskChannelIcon channel={channel} className="h-3.5 w-3.5" />
                {channel}
              </span>
            )}
            <p className="mt-2 text-xs text-slate-600">
              {display(service, "riskReason", "risk_reason", "riskNotes", "risk_notes", "complianceNotes", "compliance_notes") !== "—"
                ? display(service, "riskReason", "risk_reason", "riskNotes", "risk_notes", "complianceNotes", "compliance_notes")
                : channelDirective(channel)}
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-700">
              {copy.riskChannel}
              <select
                value={selectedRiskChannel}
                onChange={(event) => void submitRiskChannel(event.currentTarget.value)}
                disabled={!serviceId || riskChannelSaving}
                className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-wait disabled:bg-slate-50"
              >
                <option value="">{copy.selectRiskChannel}</option>
                <option value="Green">Green</option>
                <option value="Yellow">Yellow</option>
                <option value="Blue">Blue</option>
                <option value="Red">Red</option>
              </select>
            </label>
            {riskChannelSaving && <p role="status" className="mt-2 text-xs text-slate-500">{copy.updatingRiskChannel}</p>}
            {riskChannelFeedback && (
              <p
                role={riskChannelFeedbackError ? "alert" : "status"}
                className={`mt-2 text-xs ${riskChannelFeedbackError ? "text-rose-700" : "text-emerald-700"}`}
              >
                {riskChannelFeedback}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-slate-500" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent activity</p>
            </div>
            {recentActivity.length ? (
              <ol className="mt-3 space-y-3">
                {recentActivity.map((activity, index) => (
                  <li key={readText(readField(activity, "id", "activityId")) || index} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-xs font-medium text-slate-700">{display(activity, "description", "title", "action", "message")}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {formatRelativeAge(readField(activity, "createdAt", "createAt", "timestamp"))}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs text-slate-500">No activity has been recorded for this service.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-500" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Logistics</p>
            </div>
            {logisticsTransport && logisticsTransport !== "—" && (
              <p className="mt-2 text-xs font-medium text-slate-800">
                {logisticsTransport}
              </p>
            )}
            {routeLabel && <p className="mt-1 text-xs text-slate-500">{routeLabel}</p>}
            {joinPresent(
              display(consignor, "routeCategory", "route_category"),
              mode,
              eta !== "—" ? `ETA ${eta}` : "",
            ) && (
              <p className="mt-1 text-xs text-slate-500">
                {joinPresent(
                  display(consignor, "routeCategory", "route_category"),
                  mode,
                  eta !== "—" ? `ETA ${eta}` : "",
                )}
              </p>
            )}
            {transports.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {transports.map((transport, index) => (
                  <li key={readText(readField(transport, "id", "transportId")) || `logistics-${index}`} className="text-xs">
                    <p className="font-medium text-slate-700">
                      {display(transport, "fullName", "driverName", "name")} · {display(transport, "plateNumber", "vehiclePlate")}
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      {joinPresent(
                        display(transport, "phoneNumber", "phone"),
                        formatProductAmount(readField(transport, "productAmount")),
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
