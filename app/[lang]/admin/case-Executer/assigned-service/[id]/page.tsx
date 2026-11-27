"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  Flag,
  LoaderCircle,
  MapPin,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Truck,
  UploadCloud,
  X,
} from "lucide-react";
import type {
  ManagerServiceActivity,
  ManagerServiceDetail,
  ManagerServiceDocument,
  ManagerServiceStage,
  ManagerStageDiscussion,
} from "@/modules/manager/manager.type";
import { normalizeManagerServiceDetail } from "@/modules/manager/manager.store";
import { CaseExecutorEndpoints } from "@/modules/case-Executer/case-executor.endpoint";
import { getCaseExecutorServicesCopy } from "@/features/services/service.copy";
import { messageEndpoints } from "@/modules/message/message.endpoint";
import useAuthStore from "@/modules/auth/auth.store";

type WorkspaceTab = "stage" | "documents" | "discussion" | "consignment";
type StageStatus = "NotStarted" | "InProgress" | "NeedsReview" | "RequiresCustomerAction" | "Completed" | "Blocked";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getValue = (record: Record<string, unknown>, ...keys: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    keys.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

const requestErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (isRecord(error)) {
    const response = getValue(error, "response");
    const data = isRecord(response) ? getValue(response, "data") : undefined;
    if (isRecord(data)) {
      const message = text(getValue(data, "message", "detail", "title"));
      if (message) return message;
    }
    const message = text(getValue(error, "message"));
    if (message) return message;
  }
  return fallback;
};

const unwrapRows = (value: unknown, keys: string[] = []): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of [...keys, "data", "response", "payload", "result", "items", "records", "stages", "documents", "activities", "discussions", "comments"]) {
    const nested = getValue(value, key);
    if (nested !== undefined && nested !== value) {
      const rows = unwrapRows(nested, keys);
      if (rows.length || Array.isArray(nested)) return rows;
    }
  }
  return [];
};

const unwrapService = (value: unknown): unknown => {
  let current = value;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!isRecord(current)) return current;
    const nested = getValue(current, "assignedService", "service", "data", "payload", "response", "result");
    if (!isRecord(nested)) return current;
    current = nested;
  }
  return current;
};

const positiveId = (value: unknown): number | null => {
  const normalized = text(value);
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const id = Number(normalized);
  return Number.isSafeInteger(id) ? id : null;
};

const formatDate = (value: string | null | undefined, dateOnly = false): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateOnly
    ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const formatRelative = (value: string | null | undefined): string => {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const formatDuration = (hours: number | null): string => {
  if (hours === null || !Number.isFinite(hours)) return "—";
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return days ? `${days}d ${remainingHours}h` : `${remainingHours}h`;
};

const stageExecutionId = (stage: ManagerServiceStage): number | null =>
  positiveId(stage.workflowStageId)
  ?? positiveId(stage.stageId)
  ?? positiveId(stage.serviceStageId)
  ?? positiveId(stage.stageExecutionId)
  ?? positiveId(stage.serviceStageExecutionId)
  ?? positiveId(stage.executionId)
  ?? positiveId(stage.id);

const getMode = (service: ManagerServiceDetail): "Unimodal" | "Multimodal" => {
  const rawMode = service.mode ?? service.serviceType;
  if (typeof rawMode === "string") {
    if (rawMode.toLowerCase().includes("uni")) return "Unimodal";
    if (rawMode.toLowerCase().includes("multi")) return "Multimodal";
  }
  return Number(rawMode) === 2 ? "Unimodal" : "Multimodal";
};

const getStageStatus = (stage: ManagerServiceStage): string => {
  const raw = stage.status ?? stage.apiStatus ?? stage.stageStatus ?? stage.currentStatus;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
    return ({
      1: "Not started",
      2: "Not started",
      3: "In progress",
      4: "Completed",
      5: "Blocked",
      6: "Needs review",
      7: "Requires customer action",
    } as Record<number, string>)[Number(raw)] ?? "Not started";
  }
  const normalized = text(raw).toLowerCase().replaceAll(/[\s_-]+/g, "");
  if (normalized.includes("complete")) return "Completed";
  if (normalized.includes("block")) return "Blocked";
  if (normalized.includes("review")) return "Needs review";
  if (normalized.includes("customeraction")) return "Requires customer action";
  if (normalized.includes("progress") || normalized.includes("active")) return "In progress";
  return "Not started";
};

const getServiceStatus = (value: string | number): string => {
  const raw = text(value);
  if (/^\d+$/.test(raw)) {
    return ({
      1: "Draft",
      2: "Submitted",
      3: "Under review",
      4: "Approved",
      5: "In progress",
      6: "Completed",
      7: "Rejected",
      8: "Cancelled",
      9: "Delivered",
    } as Record<number, string>)[Number(raw)] ?? `Status ${raw}`;
  }
  return raw.replaceAll(/([a-z])([A-Z])/g, "$1 $2") || "Status unavailable";
};

const getRisk = (service: ManagerServiceDetail): string => {
  const raw = service.risk_channel ?? service.riskLevel;
  if (typeof raw === "string" && !/^\d+$/.test(raw)) {
    const channel = raw.toLowerCase();
    if (channel.includes("red")) return "Red channel";
    if (channel.includes("yellow")) return "Yellow channel";
    if (channel.includes("green")) return "Green channel";
    if (channel.includes("blue")) return "Blue channel";
  }
  return ({
    1: "Blue channel",
    2: "Green channel",
    3: "Yellow channel",
    4: "Red channel",
  } as Record<number, string>)[Number(raw)] ?? "Unassigned";
};

const stageTone = (status: string): string => {
  if (status.includes("Completed")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status.includes("Blocked")) return "border-rose-200 bg-rose-50 text-rose-700";
  if (status.includes("Review")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (status.includes("Progress")) return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const statusValue: Record<StageStatus, number> = {
  NotStarted: 1,
  InProgress: 3,
  NeedsReview: 6,
  RequiresCustomerAction: 7,
  Completed: 4,
  Blocked: 5,
};

const toStageStatusValue = (status: string): StageStatus => ({
  "Not started": "NotStarted",
  "In progress": "InProgress",
  "Needs review": "NeedsReview",
  "Requires customer action": "RequiresCustomerAction",
  Completed: "Completed",
  Blocked: "Blocked",
} as Record<string, StageStatus>)[status] ?? "InProgress";

const riskValue: Record<string, number> = {
  blue: 1,
  green: 2,
  yellow: 3,
  red: 4,
};

const normalizeDocument = (record: Record<string, unknown>): ManagerServiceDocument => ({
  id: getValue(record, "id", "documentId") as string | number | undefined,
  stageId: getValue(record, "workflowStageId", "stageId", "serviceStageId") as string | number | null | undefined,
  fileName: text(getValue(record, "fileName", "storedFileName")) || null,
  originalFileName: text(getValue(record, "originalFileName", "originalName")) || null,
  documentName: text(getValue(record, "documentName", "name", "documentType")) || null,
  documentType: text(getValue(record, "documentType", "type")) || null,
  mimeType: text(getValue(record, "mimeType", "contentType")) || null,
  isVerified: getValue(record, "isVerified", "verified") === true || getValue(record, "isVerified", "verified") === 1,
  createAt: text(getValue(record, "createAt", "createdAt", "uploadedAt")) || null,
  uploadedBy: text(getValue(record, "uploadedByName", "uploadedBy", "uploaderName")) || null,
});

const normalizeActivity = (record: Record<string, unknown>, index: number): ManagerServiceActivity | null => {
  const date = text(getValue(record, "date", "createdAt", "createAt", "timestamp", "activityDate"));
  const label = text(getValue(record, "label", "action", "description", "activity", "event"));
  if (!date || !label) return null;
  return {
    id: text(getValue(record, "id", "activityId")) || `${date}-${index}`,
    date,
    label,
    actorName: text(getValue(record, "actorName", "userName", "createdByName", "performedBy")) || null,
  };
};

const normalizeDiscussion = (record: Record<string, unknown>, index: number): ManagerStageDiscussion | null => {
  const comment = text(getValue(record, "comment", "message", "content", "text"));
  if (!comment) return null;
  return {
    id: text(getValue(record, "id", "commentId", "discussionId")) || `discussion-${index}`,
    comment,
    createdAt: text(getValue(record, "createdAt", "createAt", "timestamp")) || null,
    author: text(getValue(record, "author", "authorName", "userName", "createdByName")) || null,
    role: text(getValue(record, "role", "roleName")) || null,
  };
};

const blobFrom = (value: unknown): Blob | null => {
  if (value instanceof Blob) return value;
  if (isRecord(value) && value.data instanceof Blob) return value.data;
  return null;
};

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

function DocumentList({
  documents,
  copy,
  onDownload,
  onPreview,
  onVerify,
  onDelete,
  busyId,
}: {
  documents: ManagerServiceDocument[];
  copy: ReturnType<typeof getCaseExecutorServicesCopy>;
  onDownload: (document: ManagerServiceDocument) => void;
  onPreview: (document: ManagerServiceDocument) => void;
  onVerify: (document: ManagerServiceDocument) => void;
  onDelete: (document: ManagerServiceDocument) => void;
  busyId: string | null;
}) {
  if (!documents.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No documents were returned for this service.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
      {documents.map((document, index) => {
        const documentId = document.id === undefined || document.id === null ? "" : String(document.id);
        const name = document.originalFileName || document.fileName || document.documentName || `${copy.document} ${index + 1}`;
        return (
          <li key={documentId || `${name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><FileText className="size-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{text(document.documentType) || copy.document} · {document.uploadedBy || copy.uploaderUnavailable} · {formatDate(document.createAt)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs ${document.isVerified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{document.isVerified ? copy.verified : copy.outstanding}</span>
              <button type="button" disabled={!documentId || busyId === documentId} onClick={() => onPreview(document)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"><Eye className="mr-1 inline size-3.5" />{copy.preview}</button>
              <button type="button" disabled={!documentId || busyId === documentId} onClick={() => onDownload(document)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"><Download className="mr-1 inline size-3.5" />{copy.download}</button>
              <button type="button" disabled={!documentId || busyId === documentId} onClick={() => onVerify(document)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">{document.isVerified ? copy.unverify : copy.verify}</button>
              <button type="button" disabled={!documentId || busyId === documentId} onClick={() => onDelete(document)} className="rounded-md border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50">{copy.delete}</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function CaseExecutorAssignedServiceDetailPage() {
  const params = useParams<{ lang: string; id: string }>();
  const lang = params.lang || "en";
  const copy = getCaseExecutorServicesCopy(lang);
  const authUser = useAuthStore((state) => state.user);
  const id = params.id;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [service, setService] = useState<ManagerServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageLoadError, setStageLoadError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ManagerServiceDocument[]>([]);
  const [activities, setActivities] = useState<ManagerServiceActivity[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [discussions, setDiscussions] = useState<ManagerStageDiscussion[]>([]);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("stage");
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [stageDrafts, setStageDrafts] = useState<Record<string, {
    status: StageStatus;
    riskChannel: string;
    note: string;
  }>>({});
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [stageFeedback, setStageFeedback] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("");
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentBusyId, setDocumentBusyId] = useState<string | null>(null);
  const [discussionError, setDiscussionError] = useState<string | null>(null);
  const [discussionFeedback, setDiscussionFeedback] = useState<string | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalationReason, setEscalationReason] = useState("");
  const [showNotify, setShowNotify] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadService = useCallback(async () => {
    const serviceId = positiveId(id);
    if (serviceId === null) {
      setError("A valid numeric service ID is required.");
      setLoading(false);
      return;
    }

    setError(null);
    setStageLoadError(null);
    setDocumentError(null);
    setActivityError(null);
    try {
      const response = await CaseExecutorEndpoints.getWorkspace(serviceId);
      const serviceResponse = unwrapService(response);
      let normalized = normalizeManagerServiceDetail(serviceResponse);
      if (!normalized) throw new Error("No service details were returned by the Case Executor API.");

      if (!normalized.stages.length) {
        try {
          const stagesResponse = await CaseExecutorEndpoints.getServiceStages(serviceId);
          const stages = unwrapRows(stagesResponse, ["stages", "serviceStages", "shipmentStages"]);
          if (stages.length) {
            normalized = normalizeManagerServiceDetail({ ...normalized, stages }) ?? normalized;
          } else if (!stages.length) {
            setStageLoadError("The workflow stage API returned no stages for this service.");
          }
        } catch (stageError: unknown) {
          setStageLoadError(stageError instanceof Error ? stageError.message : "Unable to load workflow stages.");
        }
      }

      setService(normalized);
      setDocuments(normalized.documents);

      const [documentResponse, activityResponse] = await Promise.allSettled([
        CaseExecutorEndpoints.getServiceDocuments(serviceId),
        CaseExecutorEndpoints.getMyActivity(),
      ]);
      if (documentResponse.status === "fulfilled") {
        const fetchedDocuments = unwrapRows(documentResponse.value, ["documents", "serviceDocuments"])
          .filter(isRecord)
          .map(normalizeDocument);
        setDocuments(fetchedDocuments.length ? fetchedDocuments : normalized.documents);
      } else {
        setDocumentError(documentResponse.reason instanceof Error ? documentResponse.reason.message : "Unable to load service documents.");
      }
      if (activityResponse.status === "fulfilled") {
        const activityRows = unwrapRows(activityResponse.value, ["activities", "recentActivity", "userActivities"])
          .filter(isRecord);
        const serviceActivities = activityRows.flatMap((raw, index) => {
          const activity = normalizeActivity(raw, index);
          if (!activity) return [];
            const serviceRef = text(getValue(raw, "serviceId", "shipmentId", "referenceId"));
          return serviceRef === String(serviceId) ? [activity] : [];
        });
        setActivities(serviceActivities.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()));
      } else {
        setActivityError(activityResponse.reason instanceof Error ? activityResponse.reason.message : "Unable to load recent activity.");
      }
    } catch (requestError: unknown) {
      setService(null);
      setError(requestErrorMessage(requestError, "Unable to load assigned service."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadService(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadService]);

  const workflowStages = useMemo(() => [...(service?.stages ?? [])].sort((a, b) => a.order - b.order), [service]);
  const currentStage = workflowStages[activeStageIndex] ?? null;
  const currentStageId = currentStage ? stageExecutionId(currentStage) : null;
  const stageDraftKey = `${id}:${currentStageId ?? activeStageIndex}`;
  const savedStageDraft = stageDrafts[stageDraftKey];
  const stageStatus = savedStageDraft?.status ?? toStageStatusValue(currentStage ? getStageStatus(currentStage) : "In progress");
  const currentRisk = service ? getRisk(service).split(" ")[0].toLowerCase() : "";
  const riskChannel = savedStageDraft?.riskChannel ?? (riskValue[currentRisk] ? currentRisk : "");
  const stageNote = savedStageDraft?.note ?? currentStage?.notes ?? currentStage?.comments ?? "";
  const mode = service ? getMode(service) : "Multimodal";
  const stageNames = mode === "Unimodal" ? copy.unimodalStages : copy.multimodalStages;
  const getStageName = (stage: ManagerServiceStage, index: number) => {
    const raw = stage.stageName || stage.name;
    return !raw || /^stage\s*\d+$/i.test(raw) ? stageNames[index] ?? `Stage ${index + 1}` : stageNames[index] ?? raw;
  };
  const currentStageStatus = currentStage ? getStageStatus(currentStage) : "Not started";
  const completedStages = workflowStages.filter((stage) => getStageStatus(stage) === "Completed").length;
  const progress = workflowStages.length ? Math.round((completedStages / workflowStages.length) * 100) : 0;
  const allDocuments = useMemo(() => {
    const rows = [...documents, ...workflowStages.flatMap((stage) => stage.documents)];
    const byId = new Map<string, ManagerServiceDocument>();
    rows.forEach((document, index) => {
      const key = document.id === undefined || document.id === null
        ? `${document.stageId}-${document.fileName || document.originalFileName || index}`
        : String(document.id);
      byId.set(key, document);
    });
    return [...byId.values()];
  }, [documents, workflowStages]);
  const requiredDocuments = currentStage?.requiredDocuments ?? [];
  const requiredReceived = requiredDocuments.filter((document) =>
    document.documentId !== null || document.status.toLowerCase() === "received",
  ).length;

  useEffect(() => {
    if (tab !== "discussion" || !currentStageId || !service) return;
    let active = true;
    const timeoutId = window.setTimeout(() => {
      setDiscussionLoading(true);
      setDiscussionError(null);
      void CaseExecutorEndpoints.getStageDiscussions(String(service.id), currentStageId)
        .then((response) => {
          if (!active) return;
          const rows = unwrapRows(response, ["discussions", "stageDiscussions", "comments", "messages"])
            .filter(isRecord)
            .map(normalizeDiscussion)
            .filter((item): item is ManagerStageDiscussion => item !== null);
          setDiscussions(rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
        })
        .catch((requestError: unknown) => {
          if (active) setDiscussionError(requestErrorMessage(requestError, "Unable to load stage discussion."));
        })
        .finally(() => {
          if (active) setDiscussionLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [currentStageId, service, tab]);

  const submitStage = async (targetStatus: StageStatus, advance = false) => {
    const serviceId = positiveId(service?.id);
    if (serviceId === null || currentStageId === null) {
      setStageError("A valid service ID and workflow stage ID are required to update this stage.");
      return;
    }
    if (targetStatus === "Blocked" && !stageNote.trim()) {
      setStageError("Add a stage note before marking this stage blocked.");
      return;
    }
    setBusy(true);
    setStageError(null);
    setStageFeedback(null);
    let updated = false;
    try {
      if (targetStatus === "Blocked") {
        await CaseExecutorEndpoints.blockStage({
          shipmentId: serviceId,
          stageId: currentStageId,
          reason: stageNote.trim(),
        });
      } else {
        await CaseExecutorEndpoints.updateAssignedStageStatus({
          shipmentId: serviceId,
          stageId: currentStageId,
          status: statusValue[targetStatus],
          notes: stageNote.trim(),
        });
      }
      updated = true;
      const normalizedRisk = riskValue[riskChannel];
      if (normalizedRisk) {
        await CaseExecutorEndpoints.setRiskLevel({
          shipmentId: serviceId,
          riskLevel: normalizedRisk,
          riskNotes: stageNote.trim() || null,
        });
      }
      setStageDrafts((drafts) => ({
        ...drafts,
        [stageDraftKey]: { status: targetStatus, riskChannel, note: stageNote },
      }));
      setStageFeedback("Stage changes saved.");
      if (advance && activeStageIndex < workflowStages.length - 1) setActiveStageIndex(activeStageIndex + 1);
      await loadService();
    } catch (requestError: unknown) {
      setStageError(updated
        ? `Stage status was saved, but the risk update failed: ${requestError instanceof Error ? requestError.message : "Request failed."}`
        : requestError instanceof Error ? requestError.message : "Unable to update this stage.");
    } finally {
      setBusy(false);
    }
  };

  const selectFile = (file: File | null) => {
    setDocumentError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const extAllowed = /\.(pdf|jpe?g|png|xlsx)$/i.test(file.name);
    const mimeAllowed = !file.type || [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(file.type);
    if (!extAllowed || !mimeAllowed) {
      setDocumentError("Choose a PDF, JPG, PNG, or XLSX file.");
      setSelectedFile(null);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setDocumentError("Each file must be 25 MB or smaller.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const uploadStageDocument = async () => {
    const serviceId = positiveId(service?.id);
    if (!selectedFile || serviceId === null || currentStageId === null) {
      setDocumentError("A valid service and workflow stage ID are required to upload a document.");
      return;
    }
    const payload = new FormData();
    payload.append("file", selectedFile, selectedFile.name);
    payload.append("documentType", documentType || "Supporting document");
    setBusy(true);
    setDocumentError(null);
    try {
      await CaseExecutorEndpoints.uploadWorkspaceStageDocument(serviceId, currentStageId, payload);
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadService();
    } catch (requestError: unknown) {
      setDocumentError(requestErrorMessage(requestError, "Unable to upload this document."));
    } finally {
      setBusy(false);
    }
  };

  const documentAction = async (
    document: ManagerServiceDocument,
    action: "download" | "preview" | "verify" | "delete",
  ) => {
    if (!document.id) return;
    const serviceId = positiveId(service?.id);
    if (serviceId === null) return;
    const source = document.stageId ? "stage" : "service";
    setDocumentBusyId(String(document.id));
    setDocumentError(null);
    try {
      if (action === "verify") {
        await CaseExecutorEndpoints.verifyAssignedDocument({ documentId: document.id, source });
        await loadService();
      } else if (action === "delete") {
        await CaseExecutorEndpoints.deleteAssignedDocument(document.id, source);
        setDocuments((current) => current.filter((item) => String(item.id) !== String(document.id)));
      } else {
        const response = await CaseExecutorEndpoints.downloadAssignedDocument(document.id, source);
        const blob = blobFrom(response);
        if (!blob) throw new Error("The document endpoint did not return a file.");
        const url = URL.createObjectURL(blob);
        const name = document.originalFileName || document.fileName || document.documentName || "service-document";
        if (action === "preview") {
          window.open(url, "_blank", "noopener,noreferrer");
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } else {
          const anchor = window.document.createElement("a");
          anchor.href = url;
          anchor.download = name;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch (requestError: unknown) {
      setDocumentError(requestError instanceof Error ? requestError.message : "Unable to complete the document action.");
    } finally {
      setDocumentBusyId(null);
    }
  };

  const submitDiscussion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const serviceId = positiveId(service?.id);
    if (serviceId === null || currentStageId === null || !discussionDraft.trim()) {
      setDiscussionError("Select a valid stage and enter a discussion comment.");
      return;
    }
    setBusy(true);
    setDiscussionError(null);
    setDiscussionFeedback(null);
    try {
      await CaseExecutorEndpoints.addWorkspaceStageDiscussion(
        serviceId,
        currentStageId,
        discussionDraft.trim(),
      );
      setDiscussionDraft("");
      setDiscussionFeedback("Discussion comment added.");
      const response = await CaseExecutorEndpoints.getStageDiscussions(String(serviceId), currentStageId);
      setDiscussions(unwrapRows(response, ["discussions", "stageDiscussions", "comments", "messages"])
        .filter(isRecord)
        .map(normalizeDiscussion)
        .filter((item): item is ManagerStageDiscussion => item !== null));
    } catch (requestError: unknown) {
      setDiscussionError(requestErrorMessage(requestError, "Unable to add discussion comment."));
    } finally {
      setBusy(false);
    }
  };

  const submitServiceAction = async (event: FormEvent<HTMLFormElement>, action: "escalate" | "notify" | "message") => {
    event.preventDefault();
    const serviceId = positiveId(service?.id);
    if (serviceId === null) {
      setActionError("A valid service ID is required.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setActionFeedback(null);
    try {
      if (action === "escalate") {
        if (!escalationReason.trim()) throw new Error("Enter an escalation reason.");
        await CaseExecutorEndpoints.escalateService({ serviceId, reason: escalationReason.trim() });
        setShowEscalate(false);
        setEscalationReason("");
        setActionFeedback("Service escalation submitted.");
      } else if (action === "notify") {
        if (!messageBody.trim()) throw new Error("Enter a notification message.");
        await CaseExecutorEndpoints.notifyImporter({
          serviceId,
          subject: messageSubject.trim() || "Service update",
          message: messageBody.trim(),
        });
        setShowNotify(false);
        setMessageSubject("");
        setMessageBody("");
        setActionFeedback("Importer notification sent.");
      } else {
        if (!messageBody.trim()) throw new Error("Enter a message.");
        const recipientId = positiveId(service?.importer?.id ?? service?.customerId);
        if (recipientId === null) throw new Error("The importer has no valid user ID for direct messaging.");
        await messageEndpoints.sendMessage({
          serviceId,
          recipientId,
          subject: messageSubject.trim() || "Service message",
          content: messageBody.trim(),
          type: 2,
        });
        setShowMessage(false);
        setMessageSubject("");
        setMessageBody("");
        setActionFeedback("Message sent to importer.");
      }
    } catch (requestError: unknown) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to complete this action.");
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
        <LoaderCircle className="size-4 animate-spin" /> {copy.loadingService}
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href={`/${lang}/admin/case-Executer/assigned-service`} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-700"><ArrowLeft className="size-4" />{copy.backToServices}</Link>
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="mr-2 inline size-4" />{error || copy.serviceNotFound}</div>
      </div>
    );
  }

  const importerName = service.importer?.name || service.importer?.businessName || service.importerName || copy.importerUnavailable;
  const signedInExecutorName = [authUser?.firstName, authUser?.lastName].filter(Boolean).join(" ")
    || authUser?.username
    || authUser?.email
    || "";
  const risk = getRisk(service);
  const riskDescription = risk === "Unassigned"
    ? copy.unassignedRisk
    : service.risk_channel_description || (risk.includes("Red") ? copy.redRisk : risk.includes("Yellow") ? copy.yellowRisk : risk.includes("Green") ? copy.greenRisk : copy.blueRisk);
  const riskClass = risk.includes("Red") ? "border-rose-200 bg-rose-50 text-rose-700"
    : risk.includes("Yellow") ? "border-amber-200 bg-amber-50 text-amber-800"
      : risk.includes("Green") ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-sky-200 bg-sky-50 text-sky-700";
  const serviceLabel = service.code || service.trackingNumber;
  const statusLabel = getServiceStatus(service.status);
  const assignedStaff = [
    [copy.caseExecutor, service.assigned_staff?.executor?.name || service.assignedCaseExecutor?.name || signedInExecutorName || "Not assigned"],
    [copy.assessor, service.assigned_staff?.assessor?.name || service.assignedAssessor?.name || "Not assigned"],
  ] as const;
  const activityTimeline = [
    ...activities,
    ...service.recentActivity,
  ].filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index)
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 6);
  const previousStage = activeStageIndex > 0 ? workflowStages[activeStageIndex - 1] : null;
  const currentStageName = currentStage ? getStageName(currentStage, activeStageIndex) : "Service details";
  const previousSummary = currentStage?.previousStageSummary;
  const previousSummaryStatus = previousSummary?.status || (previousStage ? getStageStatus(previousStage) : "");
  const previousSummaryNote = previousSummary?.summaryNote || previousStage?.notes || previousStage?.comments || "";
  const previousCompletedAt = previousSummary?.completedAt || previousStage?.completedAt || previousStage?.updatedAt || "";
  const previousDuration = previousSummary?.durationHours
    ?? (previousStage?.startedAt && previousCompletedAt
      ? Math.max(0, (new Date(previousCompletedAt).getTime() - new Date(previousStage.startedAt).getTime()) / 3_600_000)
      : null);
  const previousExecutor = previousSummary?.completedByName || service.assignedCaseExecutor?.name || "Executor unavailable";

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${lang}/admin/case-Executer/assigned-service`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-700"><ArrowLeft className="size-4" />{copy.backToServices}</Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setShowEscalate(true); setActionError(null); }} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"><Flag className="size-3.5" />{copy.escalate}</button>
          <button type="button" onClick={() => { setShowNotify(true); setActionError(null); }} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"><Send className="size-3.5" />{copy.notifyImporter}</button>
          <button type="button" onClick={() => { setRefreshing(true); void loadService(); }} disabled={refreshing} aria-label={copy.refresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />{copy.refresh}</button>
        </div>
      </div>

      {actionFeedback && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{actionFeedback}</p>}
      {actionError && !showEscalate && !showNotify && !showMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{actionError}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-bold text-slate-900">{serviceLabel}</h1>
              {service.reference_number && service.reference_number !== serviceLabel && <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">{service.reference_number}</span>}
              <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${stageTone(statusLabel)}`}>{statusLabel}</span>
              <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${riskClass}`}>{risk}</span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs">{mode}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-900">{service.cargo_description || service.description || copy.cargoUnavailable}</h2>
            <p className="mt-1 text-sm text-slate-500">{importerName} · {service.route_summary || [service.origin, service.destination].filter(Boolean).join(" → ") || copy.routeUnavailable} · {copy.eta} {formatDate(service.estimated_arrival || service.eta, true)}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500"><span>Stage {Math.min(activeStageIndex + 1, workflowStages.length || 1)} of {workflowStages.length}</span><span className="font-semibold text-slate-800">{progress}% complete</span></div>
          <div className="flex h-2 gap-1 overflow-hidden rounded-full bg-slate-100">
            {workflowStages.map((stage, index) => <span key={stageExecutionId(stage) ?? `${stage.order}-${index}`} className={`min-w-0 flex-1 ${getStageStatus(stage) === "Completed" ? "bg-emerald-600" : index === activeStageIndex ? "bg-blue-600" : "bg-slate-200"}`} />)}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(220px,0.82fr)_minmax(390px,1.55fr)_minmax(240px,0.9fr)]">
        <aside className="max-h-[calc(100vh-12rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{mode === "Unimodal" ? copy.unimodalWorkflow : copy.multimodalWorkflow}</p>
          {stageLoadError && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{stageLoadError}</p>}
          {workflowStages.length ? (
            <ol className="mt-4 space-y-1">
              {workflowStages.map((stage, index) => {
                const status = getStageStatus(stage);
                const active = index === activeStageIndex;
                return (
                  <li key={stageExecutionId(stage) ?? `${stage.order}-${index}`}>
                    <button type="button" onClick={() => { setActiveStageIndex(index); setTab("stage"); }} className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left ${active ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-slate-50"}`}>
                      <span className="mt-0.5">{status === "Completed" ? <CheckCircle2 className="size-5 text-emerald-600" /> : status === "Blocked" ? <Ban className="size-5 text-rose-600" /> : status === "Needs review" ? <ShieldAlert className="size-5 text-amber-600" /> : <span className={`block size-5 rounded-full border-2 ${active || status === "In progress" ? "border-blue-600 bg-blue-50" : "border-dashed border-slate-400"}`} />}</span>
                      <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900"><span className="mr-2 font-mono text-xs text-slate-400">{String(stage.order || index + 1).padStart(2, "0")}</span>{getStageName(stage, index)}</span><span className="mt-0.5 block text-xs text-slate-500">{status}</span></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : !stageLoadError ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">{copy.noStages}</p> : null}
        </aside>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.stageWorkspace}</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{currentStageName}</h2></div>
            {currentStage && <span className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${stageTone(currentStageStatus)}`}>{currentStageStatus}</span>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            {([
              ["stage", copy.stageWork],
              ["documents", `${copy.documents} (${allDocuments.length})`],
              ["discussion", `${copy.discussion} (${discussions.length || currentStage?.discussionCount || 0})`],
              ["consignment", copy.consignment],
            ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}
          </div>

          <div className="mt-4 space-y-4">
            {tab === "stage" && currentStage ? (
              <>
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{copy.previousStageSummary}</h3><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{copy.carriedForwardContext}</span></div>
                  {previousStage || previousSummary ? (
                    <>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{previousSummary?.stageName || (previousStage ? getStageName(previousStage, activeStageIndex - 1) : "Previous stage")}</p>
                        <span className={`rounded-full border px-2.5 py-1 text-xs ${stageTone(previousSummaryStatus)}`}>{previousSummaryStatus}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{previousSummaryNote || "No summary or carried-over note is available."}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {previousCompletedAt ? `${copy.completed} ${formatDate(previousCompletedAt)} · ` : ""}
                        {previousDuration !== null ? `${formatDuration(previousDuration)} · ` : ""}
                        {previousExecutor}
                      </p>
                    </>
                  ) : <p className="mt-2 text-sm text-slate-500">No previous stage summary is available.</p>}
                </section>

                <section className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{copy.requiredDocuments}</h3><span className="text-xs text-slate-500">{requiredReceived} of {requiredDocuments.length} received</span></div>
                  {requiredDocuments.length ? <ul className="mt-3 divide-y divide-slate-100">{requiredDocuments.map((document, index) => { const received = document.documentId !== null || document.status.toLowerCase() === "received"; return <li key={`${document.documentType}-${index}`} className="flex items-center justify-between gap-2 py-2 text-sm"><span>{document.documentType}</span><span className={`rounded-full px-2.5 py-1 text-xs ${received ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{received ? copy.received : copy.outstanding}</span></li>; })}</ul> : <p className="mt-3 text-sm text-slate-500">No required documents were returned for this stage.</p>}
                </section>

                <section className="rounded-xl border border-slate-200 p-4">
                  <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx" className="hidden" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
                  <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0] ?? null); }} className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                    <UploadCloud className="size-7 text-slate-500" /><h3 className="mt-2 text-sm font-semibold">{copy.attachDocuments}</h3><p className="mt-1 text-xs text-slate-500">{copy.uploadDescription}</p>
                    <button type="button" onClick={() => fileInput.current?.click()} disabled={busy || currentStageId === null} className="mt-3 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50">{copy.browseFiles}</button>
                  </div>
                  {currentStageId === null && <p role="alert" className="mt-2 text-xs text-amber-700">This stage has no workflow stage ID; uploads are disabled.</p>}
                  <label className="mt-3 block text-xs font-medium">{copy.documentType}<select value={documentType || requiredDocuments[0]?.documentType || "Supporting document"} onChange={(event) => setDocumentType(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"><option>Supporting document</option>{requiredDocuments.map((item, index) => <option key={`${item.documentType}-${index}`}>{item.documentType}</option>)}</select></label>
                  {selectedFile && <p className="mt-2 text-xs text-slate-600">Selected: {selectedFile.name}</p>}
                  {documentError && <p role="alert" className="mt-2 text-sm text-rose-700">{documentError}</p>}
                  <div className="mt-3 flex justify-end"><button type="button" onClick={() => void uploadStageDocument()} disabled={!selectedFile || busy || currentStageId === null} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? "Uploading..." : copy.uploadDocument}</button></div>
                </section>

                <dl className="grid gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:grid-cols-3"><InfoField label="Created" value={formatDate(currentStage.createdAt)} /><InfoField label="Last updated" value={formatDate(currentStage.updatedAt || currentStage.updated_at)} /><InfoField label="Completed" value={formatDate(currentStage.completedAt)} /></dl>

                <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold">{copy.updateStage}</h3>
                  {currentStageId === null && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This stage has no workflow stage ID; stage updates are disabled.</p>}
                  <label className="block text-xs font-medium">{copy.stageStatus}<select value={stageStatus} onChange={(event) => setStageDrafts((drafts) => ({ ...drafts, [stageDraftKey]: { status: event.target.value as StageStatus, riskChannel, note: stageNote } }))} disabled={busy || currentStageId === null} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"><option value="NotStarted">{copy.notStarted}</option><option value="InProgress">{copy.inProgress}</option><option value="NeedsReview">{copy.needsReview}</option><option value="RequiresCustomerAction">Requires customer action</option><option value="Completed">{copy.completed}</option><option value="Blocked">{copy.blocked}</option></select></label>
                  <label className="block text-xs font-medium">{copy.riskChannel}<select value={riskChannel} onChange={(event) => setStageDrafts((drafts) => ({ ...drafts, [stageDraftKey]: { status: stageStatus, riskChannel: event.target.value, note: stageNote } }))} disabled={busy || currentStageId === null} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"><option value="">Select risk channel</option><option value="green">{copy.greenRisk}</option><option value="yellow">{copy.yellowRisk}</option><option value="blue">{copy.blueRisk}</option><option value="red">{copy.redRisk}</option></select></label>
                  <label className="block text-xs font-medium">{copy.stageNote}<textarea value={stageNote} onChange={(event) => setStageDrafts((drafts) => ({ ...drafts, [stageDraftKey]: { status: stageStatus, riskChannel, note: event.target.value } }))} maxLength={2000} rows={3} disabled={currentStageId === null} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" /></label>
                  {stageError && <p role="alert" className="text-sm text-rose-700">{stageError}</p>}{stageFeedback && <p role="status" className="text-sm text-emerald-700">{stageFeedback}</p>}
                  <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy || currentStageId === null} onClick={() => void submitStage(stageStatus)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">{copy.saveDraft}</button><button type="button" disabled={busy || currentStageId === null} onClick={() => void submitStage("Completed", true)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">{copy.saveAdvance}</button><button type="button" disabled={busy || currentStageId === null} onClick={() => void submitStage("Blocked")} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700">{copy.markBlocked}</button></div>
                </section>
              </>
            ) : tab === "documents" ? (
              <div className="space-y-3">{documentError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{documentError}</p>}<DocumentList documents={allDocuments} copy={copy} busyId={documentBusyId} onDownload={(item) => void documentAction(item, "download")} onPreview={(item) => void documentAction(item, "preview")} onVerify={(item) => void documentAction(item, "verify")} onDelete={(item) => void documentAction(item, "delete")} /></div>
            ) : tab === "discussion" ? (
              <div className="space-y-4">
                {discussionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{discussionError}</p>}
                {discussionLoading ? <p role="status" className="text-sm text-slate-500">Loading discussion...</p> : discussions.length ? <ul className="space-y-3">{discussions.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4 text-slate-500" />{item.author || "Stage discussion"}</span><time className="text-xs text-slate-500">{formatDate(item.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.comment}</p></li>)}</ul> : <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{copy.noDiscussion}</p>}
                <form onSubmit={(event) => void submitDiscussion(event)} className="space-y-3 rounded-xl border border-slate-200 p-4"><label className="block text-xs font-medium">Add a stage message<textarea rows={3} maxLength={2000} value={discussionDraft} onChange={(event) => setDiscussionDraft(event.target.value)} disabled={busy || currentStageId === null} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label>{discussionFeedback && <p role="status" className="text-sm text-emerald-700">{discussionFeedback}</p>}<div className="flex justify-end"><button type="submit" disabled={busy || !discussionDraft.trim() || currentStageId === null} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Send className="size-3.5" />Add message</button></div></form>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold">{copy.consignment}</h3><dl className="mt-4 grid gap-4 sm:grid-cols-2"><InfoField label={copy.origin} value={service.logistics?.origin || service.origin} /><InfoField label={copy.destination} value={service.logistics?.destination || service.destination} /><InfoField label={copy.carrier} value={service.logistics?.carrier || service.carrier || service.logistics?.vessel || service.vessel || service.flight || ""} /><InfoField label="Route category" value={service.routeCategory || ""} /><InfoField label="ETA" value={formatDate(service.estimated_arrival || service.eta, true)} /><InfoField label="Container" value={service.logistics?.containerNumber || service.containerNumber || ""} /></dl></div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{copy.importerCard}</h3><p className="mt-3 text-sm font-semibold text-slate-900">{importerName}</p><dl className="mt-3 space-y-3"><InfoField label="Customer code" value={service.importer?.customer_code || ""} /><InfoField label={copy.tin} value={service.importer?.tin || ""} /><InfoField label={copy.contact} value={service.importer?.contact_person || ""} /><InfoField label={copy.phone} value={service.importer?.phone || ""} /></dl><button type="button" onClick={() => { setShowMessage(true); setActionError(null); }} className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50">{copy.messageImporter}</button></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{copy.assignedStaff}</h3><dl className="mt-3 space-y-3">{assignedStaff.map(([label, value]) => <InfoField key={label} label={label} value={value} />)}</dl></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{copy.riskCompliance}</h3><span className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${riskClass}`}>{risk}</span><p className="mt-3 text-sm text-slate-600">{riskDescription}</p></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{copy.recentActivity}</h3>{activityError && <p role="alert" className="mt-3 text-xs text-rose-700">{activityError}</p>}{activityTimeline.length ? <ol className="mt-3 space-y-3">{activityTimeline.map((item) => <li key={item.id} className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-blue-500" /><div className="min-w-0"><p className="text-sm text-slate-700">{item.label}</p><p className="mt-0.5 text-xs text-slate-400">{item.actorName || "System"} · {formatRelative(item.date)}</p></div></li>)}</ol> : !activityError && <p className="mt-3 text-sm text-slate-500">{copy.noActivity}</p>}</section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{copy.logistics}</h3><dl className="mt-3 space-y-3"><InfoField label={copy.carrier} value={service.logistics?.carrier || service.carrier || service.vessel || service.flight || ""} /><InfoField label={copy.origin} value={service.logistics?.origin || service.origin} /><InfoField label={copy.destination} value={service.logistics?.destination || service.destination} /><InfoField label="Route category" value={service.routeCategory || ""} /><InfoField label="ETA" value={formatDate(service.estimated_arrival || service.eta, true)} /></dl><div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><MapPin className="size-3.5" /><Truck className="size-3.5" /><Clock3 className="size-3.5" /></div></section>
        </aside>
      </section>

      {(showEscalate || showNotify || showMessage) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowEscalate(false); setShowNotify(false); setShowMessage(false); } }}>
          <section role="dialog" aria-modal="true" aria-labelledby="executor-action-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3"><div><h2 id="executor-action-title" className="text-lg font-semibold text-slate-900">{showEscalate ? copy.escalate : showNotify ? copy.notifyImporter : copy.messageImporter}</h2><p className="mt-1 text-sm text-slate-500">{serviceLabel}</p></div><button type="button" aria-label="Close dialog" onClick={() => { setShowEscalate(false); setShowNotify(false); setShowMessage(false); }} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div>
            <form onSubmit={(event) => void submitServiceAction(event, showEscalate ? "escalate" : showNotify ? "notify" : "message")} className="mt-4 space-y-3">
              {showEscalate ? <label className="block text-sm font-medium">Reason<textarea required rows={4} maxLength={2000} value={escalationReason} onChange={(event) => setEscalationReason(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label> : <><label className="block text-sm font-medium">Subject<input value={messageSubject} onChange={(event) => setMessageSubject(event.target.value)} maxLength={200} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" /></label><label className="block text-sm font-medium">Message<textarea required rows={4} maxLength={2000} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label></>}
              {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
              <div className="flex justify-end gap-2"><button type="button" onClick={() => { setShowEscalate(false); setShowNotify(false); setShowMessage(false); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">{copy.cancel}</button><button type="submit" disabled={actionBusy} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{actionBusy ? <LoaderCircle className="size-4 animate-spin" /> : copy.send}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
