"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  FileText,
  Flag,
  MapPin,
  MessageSquare,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  UploadCloud,
  Download,
  Eye,
  X,
} from "lucide-react";
import { MANAGER_WORKFLOW_STAGE_NAMES } from "@/modules/manager/manager.type";
import type {
  ManagerServiceDetail,
  ManagerServiceDocument,
  ManagerServiceStage,
  ManagerAssignedUserSummary,
  ManagerWorkflowStageStatus,
} from "@/modules/manager/manager.type";
import { useManagerStore } from "@/modules/manager/manager.store";
import { getManagerServicesCopy } from "@/features/services/service.copy";

type DetailTab = "stage" | "documents" | "discussion" | "consignment";

const formatStatus = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "Status unavailable";
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const normalized = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, "");
    const knownLabels: Record<string, string> = {
      needsreview: "Needs review",
      inprogress: "In progress",
      notstarted: "Not started",
      requirescustomeraction: "Requires customer action",
    };
    return knownLabels[normalized] ?? value;
  }

  const knownStatuses: Record<number, string> = {
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
  return knownStatuses[numeric] ?? `Status ${numeric}`;
};

const getMode = (service: ManagerServiceDetail): string => {
  const mode = service.mode ?? service.serviceType;
  if (typeof mode === "string" && !/^\d+$/.test(mode)) {
    if (mode.toLowerCase().includes("uni")) return "Unimodal";
    if (mode.toLowerCase().includes("multi")) return "Multimodal";
    return mode;
  }
  if (Number(mode) === 2) return "Unimodal";
  if (Number(mode) === 1) return "Multimodal";
  return "Mode unavailable";
};

const personName = (person: ManagerAssignedUserSummary | null | undefined): string => {
  if (!person || !person.id || Number(person.id) === 0) return "Not assigned";
  return (
    person.name ||
    person.businessName ||
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    person.username ||
    person.email ||
    "Not assigned"
  );
};

const formatDate = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const formatDateOnly = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

const formatRelativeTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
};

const formatActivityLabel = (label: string): string =>
  label
    .replaceAll(/([A-Za-z])and([A-Z])/g, "$1 and $2")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\bExit and Storage Payment\b/gi, "Exit & Storage Payment")
    .replaceAll(/\bAssessment and Tax Payment\b/gi, "Assessment & Tax Payment")
    .replaceAll(/\s+/g, " ")
    .trim();

const getBlob = (response: unknown): Blob | null => {
  if (response instanceof Blob) return response;
  if (typeof response === "object" && response !== null && "data" in response) {
    const data = response.data;
    return data instanceof Blob ? data : null;
  }
  return null;
};

const formatDuration = (start: string | null | undefined, end: string | null | undefined): string => {
  if (!start || !end) return "—";
  const durationHours = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000));
  if (!Number.isFinite(durationHours)) return "—";
  const days = Math.floor(durationHours / 24);
  const hours = durationHours % 24;
  return days ? `${days}d ${hours}h` : `${hours}h`;
};

const formatDurationHours = (hours: number | null | undefined): string => {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "—";
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return days ? `${days}d ${remainingHours}h` : `${remainingHours}h`;
};

const stageName = (stage: ManagerServiceStage, index: number): string => {
  const rawName = stage.stageName || stage.name;
  if (rawName && /^\d+$/.test(rawName)) {
    const knownNames: Record<number, string> = {
      12: "Local Permission",
      13: "Arrival",
      14: "Clearance Request",
    };
    return knownNames[Number(rawName)] ?? `Stage ${rawName}`;
  }
  return rawName || `Stage ${index + 1}`;
};

const unimodalStageName = (stage: ManagerServiceStage, index: number): string => {
  const name = stageName(stage, index);
  const normalizedName = name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  if (normalizedName === "stage1") return "Local Permission";
  if (normalizedName === "stage2") return "Arrival";
  if (normalizedName === "stage3") return "Clearance Request";
  return name;
};

const multimodalStageName = (stage: ManagerServiceStage, index: number): string => {
  if (stage.order >= 1 && stage.order <= MANAGER_WORKFLOW_STAGE_NAMES.length) {
    return MANAGER_WORKFLOW_STAGE_NAMES[stage.order - 1];
  }
  const rawName = stage.stageName || stage.name;
  const stageNumberMatch = rawName?.match(/^(?:stage\s*)?(\d+)$/i);
  if (stageNumberMatch) {
    const stageNames: Record<number, string> = {
      1: "Prepayment Invoice",
      2: "Transit Permission",
      3: "Amendment",
      4: "Drop Risk",
      5: "Delivery Order",
      6: "Warehouse Status",
      7: "Inspection",
      8: "Assessment & Tax Payment",
      9: "Emergency / Spot",
      10: "Exit & Storage Payment",
      11: "Transportation",
      12: "Clearance",
    };
    return stageNames[Number(stageNumberMatch[1])] ?? `Stage ${stageNumberMatch[1]}`;
  }
  return rawName || `Stage ${index + 1}`;
};

const getWorkflowStages = (stages: ManagerServiceStage[], isUnimodal: boolean): ManagerServiceStage[] => {
  if (!isUnimodal) {
    return MANAGER_WORKFLOW_STAGE_NAMES.map((name, index) => {
      const normalizedName = name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
      const matchingStage = stages.find((stage) => stage.order === index + 1)
        ?? stages.find((stage) =>
          (stage.stageName || stage.name || "").toLowerCase().replaceAll(/[^a-z0-9]/g, "") === normalizedName,
        );

      return {
        ...matchingStage,
        order: index + 1,
        name,
        stageName: matchingStage?.stageName || name,
        status: matchingStage?.status ?? "not_started",
        updated_at: matchingStage?.updated_at ?? null,
        notes: matchingStage?.notes ?? null,
        documents: matchingStage?.documents ?? [],
      };
    });
  }

  const stageByName = new Map<string, ManagerServiceStage>();
  stages.forEach((stage, index) => {
    const normalizedName = unimodalStageName(stage, index).toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const workflowName = normalizedName.includes("localpermission")
      ? "localpermission"
      : normalizedName === "arrival"
        ? "arrival"
        : normalizedName.includes("clearance")
          ? "clearancerequest"
          : null;

    if (workflowName && !stageByName.has(workflowName)) {
      stageByName.set(workflowName, stage);
    }
  });

  return [
    ["localpermission", "Local Permission"],
    ["arrival", "Arrival"],
    ["clearancerequest", "Clearance Request"],
  ].map(([key, name], index) => {
    const stage = stageByName.get(key);
    return {
      ...stage,
      order: index + 1,
      name,
      stageName: name,
      status: stage?.status ?? "not_started",
      updated_at: stage?.updated_at ?? null,
      notes: stage?.notes ?? null,
      documents: stage?.documents ?? [],
    };
  });
};

const stageStatus = (stage: ManagerServiceStage): string => {
  const value = stage.status ?? stage.apiStatus ?? stage.stageStatus ?? stage.currentStatus;
  const normalizedStatusLabels: Record<ManagerWorkflowStageStatus, string> = {
    completed: "Completed",
    needs_review: "Needs review",
    in_progress: "In progress",
    not_started: "Not started",
    blocked: "Blocked",
    requires_customer_action: "Requires customer action",
  };
  if (typeof value === "string" && Object.hasOwn(normalizedStatusLabels, value)) {
    return normalizedStatusLabels[value as ManagerWorkflowStageStatus];
  }
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const knownStatuses: Record<number, string> = {
      1: "Not started",
      2: "Pending",
      3: "In progress",
      4: "Completed",
      5: "Blocked",
      6: "Needs review",
      7: "Requires customer action",
    };
    return knownStatuses[Number(value)] ?? `Status ${value}`;
  }
  return formatStatus(value);
};

const stageStatusOption = (status: string): string => {
  const normalized = status.toLowerCase().replaceAll(/[\s_-]+/g, "");
  if (normalized.includes("requirescustomeraction") || normalized.includes("customeraction")) {
    return "RequiresCustomerAction";
  }
  if (normalized.includes("block")) return "Blocked";
  if (normalized.includes("complete") || normalized.includes("deliver")) return "Completed";
  if (normalized.includes("review")) return "NeedsReview";
  if (normalized.includes("progress") || normalized.includes("active")) return "InProgress";
  if (normalized.includes("notstarted")) return "NotStarted";
  return "NotStarted";
};

const riskChannelOption = (
  service: ManagerServiceDetail | null,
  stage?: ManagerServiceStage,
): string => {
  const stageRisk = typeof stage?.riskChannel === "string" ? stage.riskChannel.toLowerCase() : "";
  const stageChannel = ["blue", "green", "yellow", "red"].find((channel) => stageRisk.includes(channel));
  if (stageChannel) return stageChannel;
  const channel = service?.risk_channel?.toLowerCase();
  if (channel === "blue" || channel === "green" || channel === "yellow" || channel === "red") return channel;
  const risk = typeof service?.riskLevel === "string"
    ? service.riskLevel.toLowerCase()
    : String(service?.riskLevel ?? "");
  if (["blue", "1"].includes(risk)) return "blue";
  if (["green", "2"].includes(risk)) return "green";
  if (["yellow", "3"].includes(risk)) return "yellow";
  if (["red", "4"].includes(risk)) return "red";
  return "";
};

const getPositiveIntegerId = (value: string | number | undefined): number | null => {
  const normalized = typeof value === "number" ? String(value) : value?.trim();
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) return null;
  const id = Number(normalized);
  return Number.isSafeInteger(id) ? id : null;
};

const stageTone = (status: string): string => {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("deliver")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized.includes("block")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("progress") || normalized.includes("active")) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (normalized.includes("review") || normalized.includes("block")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (normalized.includes("customer action")) {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const stageIcon = (status: string, isActive = false) => {
  const normalized = status.toLowerCase();
  if (normalized.includes("block")) return <Ban className="h-5 w-5 text-rose-600" />;
  if (normalized.includes("complete") || normalized.includes("deliver")) {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  }
  if (isActive || normalized.includes("progress") || normalized.includes("active")) {
    return <span className="block h-5 w-5 rounded-full border-2 border-sky-600 bg-sky-50" />;
  }
  if (normalized.includes("review")) return <Search className="h-5 w-5 text-amber-600" />;
  return <span className="block h-5 w-5 rounded-full border-2 border-dashed border-slate-400" />;
};

const riskTone = (risk: string): string => {
  const normalized = risk.toLowerCase();
  if (normalized.includes("red")) return "border-red-200 bg-red-50 text-red-800";
  if (normalized.includes("yellow")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized.includes("green")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("blue")) return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
};

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 wrap-break-word text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

function DocumentsPanel({
  documents,
  error,
  actionBusy,
  onPreview,
  onDownload,
}: {
  documents: ManagerServiceDocument[];
  error: string | null;
  actionBusy: string | null;
  onPreview: (document: ManagerServiceDocument) => void;
  onDownload: (document: ManagerServiceDocument) => void;
}) {
  if (!documents.length) {
    return (
      <div className="space-y-3">
        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Unable to load service documents: {error}
          </p>
        )}
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No documents were returned for this service.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Unable to refresh service documents: {error}
        </p>
      )}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {documents.map((document, index) => {
          const name = document.originalFileName || document.fileName || document.documentName || `Document ${index + 1}`;
          const verified = document.isVerified;
          return (
            <li key={document.id ?? `${name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {document.documentType || document.mimeType || "Document"} · {document.uploadedBy || "Uploader unavailable"} · {formatDate(document.createAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  verified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"
                }`}>
                  {verified ? "Verified" : "Awaiting verification"}
                </span>
                <button
                  type="button"
                  onClick={() => onPreview(document)}
                  disabled={!document.id || actionBusy === String(document.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(document)}
                  disabled={!document.id || actionBusy === String(document.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function ManagerServiceDetailPage() {
  const { id, lang } = useParams<{ id: string; lang: string }>();
  const copy = getManagerServicesCopy(lang);
  const router = useRouter();
  const service = useManagerStore((state) => state.selectedService);
  const loading = useManagerStore((state) => state.serviceDetailLoading);
  const error = useManagerStore((state) => state.serviceDetailError);
  const documentsError = useManagerStore((state) => state.serviceDocumentsError);
  const stageDiscussions = useManagerStore((state) => state.stageDiscussions);
  const stageDiscussionsLoading = useManagerStore((state) => state.stageDiscussionsLoading);
  const stageDiscussionsError = useManagerStore((state) => state.stageDiscussionsError);
  const serviceActivities = useManagerStore((state) => state.serviceActivities);
  const serviceActivitiesError = useManagerStore((state) => state.serviceActivitiesError);
  const consignmentDetails = useManagerStore((state) => state.consignmentDetails);
  const consignmentLoading = useManagerStore((state) => state.consignmentLoading);
  const consignmentError = useManagerStore((state) => state.consignmentError);
  const fetchServiceById = useManagerStore((state) => state.fetchServiceById);
  const fetchStageDiscussions = useManagerStore((state) => state.fetchStageDiscussions);
  const fetchConsignmentDetails = useManagerStore((state) => state.fetchConsignmentDetails);
  const addStageDiscussion = useManagerStore((state) => state.addStageDiscussion);
  const notifyImporter = useManagerStore((state) => state.notifyImporter);
  const messageImporter = useManagerStore((state) => state.messageImporter);
  const escalateService = useManagerStore((state) => state.escalateService);
  const staff = useManagerStore((state) => state.staff);
  const staffLoading = useManagerStore((state) => state.staffLoading);
  const staffError = useManagerStore((state) => state.staffError);
  const fetchStaff = useManagerStore((state) => state.fetchStaff);
  const assignExecutor = useManagerStore((state) => state.assignExecutor);
  const assignAssessor = useManagerStore((state) => state.assignAssessor);
  const updateServiceStage = useManagerStore((state) => state.updateServiceStage);
  const uploadServiceDocument = useManagerStore((state) => state.uploadServiceDocument);
  const downloadManagerDocument = useManagerStore((state) => state.downloadServiceDocument);
  const [refreshing, setRefreshing] = useState(false);
  const [executorSelection, setExecutorSelection] = useState<{
    serviceId: string;
    executorId: string;
  } | null>(null);
  const [assigningExecutor, setAssigningExecutor] = useState(false);
  const [assessorSelection, setAssessorSelection] = useState<{
    serviceId: string;
    assessorId: string;
  } | null>(null);
  const [assigningAssessor, setAssigningAssessor] = useState(false);
  const [assessorAssignmentFeedback, setAssessorAssignmentFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const [assignmentFeedback, setAssignmentFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const [stageUpload, setStageUpload] = useState<{ stageKey: string; file: File } | null>(null);
  const [stageUploadBusy, setStageUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [documentType, setDocumentType] = useState("");
  const [stageUploadFeedback, setStageUploadFeedback] = useState<{
    stageKey: string;
    error?: string;
    success?: string;
  } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const stageFileInput = useRef<HTMLInputElement | null>(null);
  const [selection, setSelection] = useState<{
    serviceId: string;
    activeStage: number;
    activeTab: DetailTab;
    stageSelected: boolean;
  }>({ serviceId: "", activeStage: 0, activeTab: "stage", stageSelected: false });
  const [stageDrafts, setStageDrafts] = useState<Record<string, {
    status: string;
    notes: string;
    riskChannel: string;
  }>>({});
  const [stageSaving, setStageSaving] = useState(false);
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [discussionSubmitting, setDiscussionSubmitting] = useState(false);
  const [discussionFeedback, setDiscussionFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const [notificationType, setNotificationType] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationSubmitting, setNotificationSubmitting] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [messageImporterMode, setMessageImporterMode] = useState(false);
  const [notificationFeedback, setNotificationFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const importerMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [documentActionBusy, setDocumentActionBusy] = useState<string | null>(null);
  const [showEscalation, setShowEscalation] = useState(false);
  const [escalationReason, setEscalationReason] = useState("");
  const [escalationSubmitting, setEscalationSubmitting] = useState(false);
  const [escalationFeedback, setEscalationFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const [stageFeedback, setStageFeedback] = useState<{
    stageKey: string;
    error?: string;
    success?: string;
  } | null>(null);
  const [actionNotice, setActionNotice] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ሰርቪሱ በትክክል ሎድ አድርጎ ሳለ "User with ID '0' was not found" የሚል ያልተገባ ስህተት ባነር እንዳይመጣ ማጣሪያ
  const displayError =
    error && !/user.*id.*['"]?0['"]?.*not found/i.test(error)
      ? error
      : null;

  const mode = service ? getMode(service) : "Mode unavailable";
  const isUnimodal = mode === "Unimodal";
  const workflowStages = service ? getWorkflowStages(service.stages, isUnimodal) : [];
  const displayStageName = (stage: ManagerServiceStage, index: number) =>
    isUnimodal ? unimodalStageName(stage, index) : multimodalStageName(stage, index);
  const localizedStageName = (stage: ManagerServiceStage, index: number) =>
    (isUnimodal ? copy.unimodalStages : copy.multimodalStages)[index] ?? displayStageName(stage, index);
  const localizedStageStatus = (status: string) =>
    copy.statuses[status as keyof typeof copy.statuses] ?? status;
  const defaultActiveStage = workflowStages.findIndex((stage) => {
    const normalized = stageStatus(stage).toLowerCase().replaceAll(/[\s_-]+/g, "");
    return normalized.includes("inprogress") || normalized.includes("active") || normalized.includes("needsreview");
  });
  const firstIncompleteStage = workflowStages.findIndex((stage) => {
    const status = stageStatus(stage).toLowerCase();
    return !status.includes("complete") && !status.includes("deliver");
  });
  const hasManualStageSelection = selection.serviceId === id
    && selection.stageSelected
    && selection.activeStage < workflowStages.length;
  const activeStage = hasManualStageSelection
    ? selection.activeStage
    : defaultActiveStage >= 0
      ? defaultActiveStage
      : firstIncompleteStage >= 0
        ? firstIncompleteStage
        : Math.max(workflowStages.length - 1, 0);
  const activeTab = selection.serviceId === id ? selection.activeTab : "stage";

  const eligibleExecutors = staff.filter((member) => {
    const roleNames = [...(member.roleNames ?? []), ...(member.assignedRoles ?? []).map((role) => role.roleName)];
    const hasExecutorRole = roleNames.some((role) => role.toLowerCase().replaceAll(/[^a-z]/g, "") === "caseexecutor");
    return member.isActive === true
      && !member.isAccountLocked
      && hasExecutorRole;
  });
  const eligibleAssessors = staff.filter((member) => {
    const roleNames = [...(member.roleNames ?? []), ...(member.assignedRoles ?? []).map((role) => role.roleName)];
    const hasAssessorRole = roleNames.some((role) => role.toLowerCase().replaceAll(/[^a-z]/g, "").includes("assessor"));
    return member.isActive === true
      && !member.isAccountLocked
      && hasAssessorRole;
  });
  const currentExecutorId = String(service?.assignedCaseExecutorId ?? "");
  const selectedExecutorId = executorSelection?.serviceId === id
    ? executorSelection.executorId
    : eligibleExecutors.some((member) => String(member.id) === currentExecutorId)
      ? currentExecutorId
      : "";
  const currentAssessorId = String(service?.assignedAssessorId ?? "");
  const selectedAssessorId = assessorSelection?.serviceId === id
    ? assessorSelection.assessorId
    : eligibleAssessors.some((member) => String(member.id) === currentAssessorId)
      ? currentAssessorId
      : "";

  const serviceIdentifier = getPositiveIntegerId(id) ?? getPositiveIntegerId(service?.id);

  useEffect(() => {
    if (!id) return;
    let isCurrent = true;
    void fetchServiceById(id).then((loadedService) => {
      const databaseId = getPositiveIntegerId(loadedService?.id);
      if (isCurrent && databaseId !== null && String(databaseId) !== id) {
        router.replace(`/${encodeURIComponent(lang)}/admin/manager/services/${databaseId}`);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [fetchServiceById, id, lang, router]);

  useEffect(() => {
    if (!staff.length) void fetchStaff();
  }, [fetchStaff, staff.length]);

  const currentStage = workflowStages[activeStage];
  const currentStageStatus = currentStage ? stageStatus(currentStage) : "Status unavailable";
  const currentStageStatusLabel = localizedStageStatus(currentStageStatus);
  const serviceStatusLabel = localizedStageStatus(formatStatus(service?.status));
  const currentStageExecutionId = currentStage?.workflowStageId
    ?? currentStage?.stageId
    ?? currentStage?.stageExecutionId
    ?? currentStage?.serviceStageExecutionId
    ?? currentStage?.executionId
    ?? currentStage?.id;
  const hasCurrentStageExecution = getPositiveIntegerId(currentStageExecutionId) !== null;
  const hasCurrentStageDocumentId = hasCurrentStageExecution;
  const discussionStageId = getPositiveIntegerId(currentStageExecutionId);
  useEffect(() => {
    if (activeTab === "discussion" && serviceIdentifier !== null && discussionStageId !== null) {
      void fetchStageDiscussions(discussionStageId, serviceIdentifier);
    }
  }, [activeTab, discussionStageId, fetchStageDiscussions, serviceIdentifier]);
  useEffect(() => {
    if (activeTab === "consignment" && serviceIdentifier !== null) {
      void fetchConsignmentDetails(serviceIdentifier);
    }
  }, [activeTab, fetchConsignmentDetails, serviceIdentifier]);
  const stageDraftKey = service && currentStageExecutionId !== null && currentStageExecutionId !== undefined
    ? `${service.id}:${currentStageExecutionId}`
    : `${id}:${activeStage}`;
  const stageStatusDraft = stageDrafts[stageDraftKey]?.status
    ?? (currentStage ? stageStatusOption(stageStatus(currentStage)) : "Pending");
  const stageNotesDraft = stageDrafts[stageDraftKey]?.notes
    ?? currentStage?.notes
    ?? currentStage?.comments
    ?? "";
  const stageRiskDraft = stageDrafts[stageDraftKey]?.riskChannel ?? riskChannelOption(service, currentStage);
  const activeStageFeedback = stageFeedback?.stageKey === stageDraftKey ? stageFeedback : null;
  const selectedStageFile = stageUpload?.stageKey === stageDraftKey ? stageUpload.file : null;
  const currentStageUploadFeedback = stageUploadFeedback?.stageKey === stageDraftKey
    ? stageUploadFeedback
    : null;
  const requiredStageDocuments = currentStage?.requiredDocuments ?? [];
  const stageDocumentTypes = [...new Set([
    ...requiredStageDocuments.map((document) => document.documentType),
    "Supporting document",
    "Commercial invoice",
    "Transport document",
    "Customs permit",
    "Inspection record",
  ])];
  const currentDocumentType = stageDocumentTypes.includes(documentType)
    ? documentType
    : stageDocumentTypes[0] ?? "Supporting document";

  const importer = service?.importer && Number(service.importer.id) !== 0
    ? service.importer.name || personName(service.importer)
    : "Not assigned";

  const risk = service?.risk_channel_label
    || (service?.risk_channel
    ? `${service.risk_channel[0].toUpperCase()}${service.risk_channel.slice(1)} channel`
    : service
      ? typeof service.riskLevel === "string" && !/^\d+$/.test(service.riskLevel)
      ? service.riskLevel
      : ({ 1: "Blue channel", 2: "Green channel", 3: "Yellow channel", 4: "Red channel" }[
          Number(service.riskLevel)
        ] ?? "Unassigned")
      : "—");
  const riskLabel = copy.channels[risk as keyof typeof copy.channels] ?? risk;
  const modeLabel = mode === "Unimodal" ? copy.unimodal : mode === "Multimodal" ? copy.multimodal : mode;
  const riskDescription = service?.risk_channel_description
    || (riskChannelOption(service) === "yellow"
      ? "Documentary review required before release. Assessor sign-off is mandatory."
      : riskChannelOption(service) === "green"
        ? "Routine checks apply before release."
        : riskChannelOption(service) === "red"
          ? "Enhanced review and release authorization are required."
          : riskChannelOption(service) === "blue"
            ? "Fast-track processing applies subject to customs controls."
            : null);
  const logisticsCarrier = service?.flight
    ? `${service.flight}${service.carrier ? ` — ${service.carrier}` : ""}`
    : service?.vessel
      ? `${service.vessel}${service.voyage ? ` / Voy. ${service.voyage}` : ""}`
      : service?.carrier || "—";
  const completedStages = workflowStages.filter((stage) => {
    const status = stageStatus(stage).toLowerCase();
    return status.includes("complete") || status.includes("deliver");
  }).length;
  const progress = workflowStages.length
    ? Math.round((completedStages / workflowStages.length) * 100)
    : null;
  const previousStage = activeStage > 0 ? workflowStages[activeStage - 1] : null;
  const previousStageSummary = currentStage?.previousStageSummary;
  const previousStageSummaryStatus = previousStageSummary?.status
    ? formatStatus(previousStageSummary.status)
    : previousStage
      ? stageStatus(previousStage)
      : "";
  const previousStageSummaryNote = previousStageSummary?.summaryNote
    || previousStage?.notes
    || previousStage?.comments;
  const recentActivity = service?.stages
    .flatMap((stage, index) => {
      const name = localizedStageName(stage, index);
      const status = stageStatus(stage);
      const activity = [];

      if (stage.completedAt && (status.toLowerCase().includes("complete") || status.toLowerCase().includes("deliver"))) {
        activity.push({ label: `${name} completed`, date: stage.completedAt });
      }
      if (stage.updatedAt) activity.push({ label: `${name} updated · ${status}`, date: stage.updatedAt });
      if (stage.createdAt) activity.push({ label: `${name} created`, date: stage.createdAt });

      return activity;
    })
    .filter((activity) => !Number.isNaN(new Date(activity.date).getTime()))
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 5) ?? [];
  const displayedActivities = [
    ...serviceActivities.map((activity) => ({
      label: activity.label,
      date: activity.date ?? "",
      actorName: activity.actorName,
    })),
    ...recentActivity,
  ]
    .filter((activity) => activity.date && !Number.isNaN(new Date(activity.date).getTime()))
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 5);

  const assignedStaff: Array<[string, ManagerServiceDetail["assignedCaseExecutor"]]> = service
    ? [
        [
          "Case executor",
          service.assigned_staff?.executor
            ? service.assigned_staff.executor
            : service.assignedCaseExecutor && Number(service.assignedCaseExecutor.id) !== 0
              ? service.assignedCaseExecutor
            : null,
        ],
        [
          "Assessor",
          service.assigned_staff?.assessor
            ? service.assigned_staff.assessor
            : service.assignedAssessor && Number(service.assignedAssessor.id) !== 0
              ? service.assignedAssessor
            : null,
        ],
      ]
    : [];

  const submitStageUpdate = async (status: string, advance = false) => {
    if (status === "Blocked" && !stageNotesDraft.trim()) {
      setStageFeedback({
        stageKey: stageDraftKey,
        error: "Add an escalation reason in the stage notes before marking this stage blocked.",
      });
      return;
    }

    const shipmentId = getPositiveIntegerId(id) ?? getPositiveIntegerId(service?.id);
    const stageId = getPositiveIntegerId(currentStageExecutionId);
    if (
      !service ||
      serviceIdentifier === null ||
      shipmentId === null ||
      stageId === null
    ) {
      setStageFeedback({
        stageKey: stageDraftKey,
        error: "A valid service ID and workflow stage ID are required to update this stage.",
      });
      return;
    }

    setStageSaving(true);
    setStageFeedback(null);

    const updatePayload = {
      serviceId: shipmentId,
      stageId,
      action: status === "Blocked" ? "block" as const : advance ? "advance" as const : "draft" as const,
      stageStatus: status,
      riskChannel: stageRiskDraft,
      stageNote: stageNotesDraft.trim(),
    };

    const updateResult = await updateServiceStage(updatePayload);
    setStageSaving(false);
    let escalationError: string | null = null;

    if (updateResult.success) {
      if (status === "Blocked") {
        try {
          await escalateService({
            serviceId: serviceIdentifier,
            reason: stageNotesDraft.trim(),
          });
        } catch (error: unknown) {
          escalationError = error instanceof Error ? error.message : "Unable to escalate this service.";
        }
      }
      setStageDrafts((drafts) => ({
        ...drafts,
        [stageDraftKey]: { status, notes: stageNotesDraft, riskChannel: stageRiskDraft },
      }));
      setActionNotice(status === "Blocked" ? "Stage blocked." : "Stage changes saved.");
      if (advance && activeStage < workflowStages.length - 1) {
        setSelection({
          serviceId: id,
          activeStage: activeStage + 1,
          activeTab: "stage",
          stageSelected: true,
        });
      }
    }
    setStageFeedback(updateResult.success
      ? escalationError
        ? { stageKey: stageDraftKey, error: `Stage updated, but escalation failed: ${escalationError}` }
        : { stageKey: stageDraftKey, success: status === "Blocked"
          ? "Stage blocked and service escalation submitted."
          : "Stage updated and refreshed from the service API." }
      : { stageKey: stageDraftKey, error: updateResult.error || "Unable to update this stage." });
  };

  const submitStageDiscussion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (serviceIdentifier === null || discussionStageId === null || !discussionDraft.trim()) {
      setDiscussionFeedback({ error: "Select a valid stage and enter a discussion comment." });
      return;
    }

    setDiscussionSubmitting(true);
    setDiscussionFeedback(null);
    try {
      await addStageDiscussion({
        serviceId: serviceIdentifier,
        stageId: discussionStageId,
        comment: discussionDraft.trim(),
      });
      await fetchServiceById(serviceIdentifier);
      setDiscussionDraft("");
      setDiscussionFeedback({ success: "Discussion comment added." });
      setActionNotice("Discussion comment added.");
    } catch (error: unknown) {
      setDiscussionFeedback({
        error: error instanceof Error ? error.message : "Unable to add discussion comment.",
      });
    } finally {
      setDiscussionSubmitting(false);
    }
  };

  const submitImporterNotification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (serviceIdentifier === null || !notificationMessage.trim()) {
      setNotificationFeedback({ error: "Enter a message before notifying the importer." });
      return;
    }

    setNotificationSubmitting(true);
    setNotificationFeedback(null);
    try {
      const messagePayload = {
        serviceId: serviceIdentifier,
        subject: notificationType.trim() || (messageImporterMode ? "Service message" : "Service update"),
        message: notificationMessage.trim(),
      };
      if (messageImporterMode) {
        await messageImporter(messagePayload);
      } else {
        await notifyImporter(messagePayload);
      }
      await fetchServiceById(serviceIdentifier);
      setNotificationType("");
      setNotificationMessage("");
      setNotificationFeedback({
        success: messageImporterMode ? "Message sent to importer." : "Importer notification sent.",
      });
      setShowNotification(false);
      setActionNotice(messageImporterMode ? "Message sent to importer." : "Importer notification sent.");
    } catch (error: unknown) {
      setNotificationFeedback({
        error: error instanceof Error ? error.message : "Unable to notify the importer.",
      });
    } finally {
      setNotificationSubmitting(false);
    }
  };

  const submitEscalation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (serviceIdentifier === null || !escalationReason.trim()) {
      setEscalationFeedback({ error: "Enter a reason before escalating this service." });
      return;
    }

    setEscalationSubmitting(true);
    setEscalationFeedback(null);
    try {
      await escalateService({ serviceId: serviceIdentifier, reason: escalationReason.trim() });
      await fetchServiceById(serviceIdentifier);
      setEscalationReason("");
      setShowEscalation(false);
      setEscalationFeedback({ success: "Service escalation submitted." });
      setActionNotice("Service escalation submitted.");
    } catch (escalationError: unknown) {
      setEscalationFeedback({
        error: escalationError instanceof Error ? escalationError.message : "Unable to escalate this service.",
      });
    } finally {
      setEscalationSubmitting(false);
    }
  };

  const selectStageFile = (file: File | null) => {
    setStageUploadFeedback({ stageKey: stageDraftKey });
    if (!file) {
      setStageUpload(null);
      return;
    }

    const extensionAccepted = /\.(pdf|jpe?g|png|xlsx)$/i.test(file.name);
    const mimeAccepted = !file.type || [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(file.type);
    const acceptedFile = extensionAccepted && mimeAccepted;
    if (!acceptedFile) {
      setStageUploadFeedback({ stageKey: stageDraftKey, error: "Choose a PDF, JPG, PNG, or Excel file." });
      setStageUpload(null);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStageUploadFeedback({ stageKey: stageDraftKey, error: "File must be 25 MB or smaller." });
      setStageUpload(null);
      return;
    }

    setStageUpload({ stageKey: stageDraftKey, file });
  };

  const uploadStageFile = async () => {
    if (!service || !selectedStageFile) return;
    const stageId = getPositiveIntegerId(currentStageExecutionId);
    const shipmentId = getPositiveIntegerId(service.id);
    if (stageId === null || shipmentId === null) {
      setStageUploadFeedback({
        stageKey: stageDraftKey,
        error: "A valid service and workflow stage ID are required to upload a document.",
      });
      return;
    }

    const formData = new FormData();
    formData.append("File", selectedStageFile, selectedStageFile.name);
    formData.append("ServiceId", String(shipmentId));
    formData.append("WorkflowStageId", String(stageId));
    formData.append("DocumentType", currentDocumentType);

    setStageUploadBusy(true);
    setUploadProgress(0);
    setStageUploadFeedback({ stageKey: stageDraftKey });
    try {
      await uploadServiceDocument(formData, setUploadProgress);
      setStageUpload(null);
      setStageUploadFeedback({
        stageKey: stageDraftKey,
        success: `${selectedStageFile.name} uploaded successfully.`,
      });
      if (stageFileInput.current) stageFileInput.current.value = "";
      await fetchServiceById(id);
      setActionNotice(`${selectedStageFile.name} uploaded successfully.`);
    } catch (uploadError: unknown) {
      setStageUploadFeedback({
        stageKey: stageDraftKey,
        error: uploadError instanceof Error ? uploadError.message : "Unable to upload this document.",
      });
    } finally {
      setStageUploadBusy(false);
      setUploadProgress(null);
    }
  };

  const refreshService = async () => {
    setRefreshing(true);
    try {
      await fetchServiceById(id);
    } finally {
      setRefreshing(false);
    }
  };

  const previewServiceDocument = async (document: ManagerServiceDocument) => {
    const documentId = document.id;
    if (documentId === undefined || documentId === null) return;
    setDocumentActionBusy(String(documentId));
    setDocumentActionError(null);
    try {
      const stageId = getPositiveIntegerId(document.stageId ?? undefined);
      if (serviceIdentifier === null || stageId === null) {
        throw new Error("The document is missing its service or workflow stage ID.");
      }
      const blob = getBlob(await downloadManagerDocument(serviceIdentifier, stageId, documentId));
      if (!blob) throw new Error("The document endpoint did not return a previewable file.");
      setPreviewName(document.originalFileName || document.fileName || document.documentName || "Service document");
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (previewError: unknown) {
      setDocumentActionError(previewError instanceof Error ? previewError.message : "Unable to preview this document.");
    } finally {
      setDocumentActionBusy(null);
    }
  };

  const downloadServiceDocument = async (document: ManagerServiceDocument) => {
    const documentId = document.id;
    if (documentId === undefined || documentId === null) return;
    setDocumentActionBusy(String(documentId));
    setDocumentActionError(null);
    try {
      const stageId = getPositiveIntegerId(document.stageId ?? undefined);
      if (serviceIdentifier === null || stageId === null) {
        throw new Error("The document is missing its service or workflow stage ID.");
      }
      const blob = getBlob(await downloadManagerDocument(serviceIdentifier, stageId, documentId));
      if (!blob) throw new Error("The document endpoint did not return a downloadable file.");
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.originalFileName || document.fileName || document.documentName || "service-document";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError: unknown) {
      setDocumentActionError(downloadError instanceof Error ? downloadError.message : "Unable to download this document.");
    } finally {
      setDocumentActionBusy(null);
    }
  };

  const assignCaseExecutor = async () => {
    const selectedStaff = eligibleExecutors.find((member) => String(member.id) === selectedExecutorId);
    const executorId = getPositiveIntegerId(selectedStaff?.id);
    if (serviceIdentifier === null || executorId === null) {
      setAssignmentFeedback({ error: "Select a case executor with a valid numeric user ID before assigning this service." });
      return;
    }

    setAssigningExecutor(true);
    setAssignmentFeedback(null);
    try {
      const payload = {
        shipmentId: serviceIdentifier,
        caseExecutorId: executorId,
      };
      const assigned = await assignExecutor(payload);
      if (!assigned) {
        throw new Error(useManagerStore.getState().error || "Unable to assign the case executor.");
      }

      await fetchServiceById(id);
      setAssignmentFeedback({ success: "Case executor assigned successfully." });
      setActionNotice("Case executor assigned successfully.");
    } catch (assignmentError: unknown) {
      setAssignmentFeedback({
        error: assignmentError instanceof Error
          ? assignmentError.message
          : "Unable to assign the case executor.",
      });
    } finally {
      setAssigningExecutor(false);
    }
  };

  const assignServiceAssessor = async () => {
    const selectedStaff = eligibleAssessors.find((member) => String(member.id) === selectedAssessorId);
    const assessorId = getPositiveIntegerId(selectedStaff?.id);
    if (serviceIdentifier === null || assessorId === null) {
      setAssessorAssignmentFeedback({ error: "Select an assessor with a valid numeric user ID before assigning this service." });
      return;
    }

    setAssigningAssessor(true);
    setAssessorAssignmentFeedback(null);
    try {
      const assigned = await assignAssessor({ serviceId: serviceIdentifier, userId: assessorId });
      if (!assigned) {
        throw new Error(useManagerStore.getState().error || "Unable to assign the assessor.");
      }
      const refreshedService = await fetchServiceById(serviceIdentifier);
      if (!refreshedService) {
        throw new Error(useManagerStore.getState().serviceDetailError || "The service could not be refreshed.");
      }
      setAssessorAssignmentFeedback({ success: "Assessor assigned successfully." });
      setActionNotice("Assessor assigned successfully.");
    } catch (assignmentError: unknown) {
      setAssessorAssignmentFeedback({
        error: assignmentError instanceof Error ? assignmentError.message : "Unable to assign the assessor.",
      });
    } finally {
      setAssigningAssessor(false);
    }
  };

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 text-slate-800">
      <Link
        href={`/${lang}/admin/manager/services`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        {copy.backToServices}
      </Link>

      {loading && !service && (
        <div role="status" aria-label="Loading service details" className="space-y-4">
          <span className="sr-only">Loading service details...</span>
          <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.85fr)_minmax(320px,1.35fr)_minmax(240px,0.9fr)]">
            <div className="h-[34rem] animate-pulse rounded-2xl border border-slate-200 bg-white" />
            <div className="h-[34rem] animate-pulse rounded-2xl border border-slate-200 bg-white" />
            <div className="h-[34rem] animate-pulse rounded-2xl border border-slate-200 bg-white" />
          </div>
        </div>
      )}
      {displayError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {displayError}
        </div>
      )}
      {!loading && !error && !service && (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          This service was not returned by the manager API.
        </p>
      )}

      {service && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-mono text-xl font-bold text-slate-900">
                    {service.code ?? service.reference_number ?? "Service identifier unavailable"}
                  </h1>
                  {service.reference_number && service.reference_number !== service.code && (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {service.reference_number}
                    </span>
                  )}
                  <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${stageTone(formatStatus(service.status))}`}>
                    {serviceStatusLabel}
                  </span>
                  <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${riskTone(risk)}`}>
                    {riskLabel}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {modeLabel}
                  </span>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {service.cargo_description || service.description || "Service description unavailable"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {importer} · {service.route_summary || [service.origin, service.destination].filter(Boolean).join(" → ") || "Route unavailable"}
                    {(service.estimated_arrival || service.eta) ? ` · ETA ${formatDateOnly(service.estimated_arrival || service.eta)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEscalation((visible) => !visible);
                    setEscalationFeedback(null);
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
                >
                  <Flag className="h-3.5 w-3.5" />
                  {copy.escalate}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessageImporterMode(false);
                    setShowNotification(true);
                    setNotificationFeedback(null);
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                >
                  <Send className="h-3.5 w-3.5" />
                  {copy.notifyImporter}
                </button>
              </div>
              <div className="text-sm text-slate-500">
                  <span className="font-medium text-slate-700">Last updated</span>
                  <p className="mt-1">{formatDate(service.updatedAt || service.createAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshService()}
                  disabled={refreshing || loading}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>
            {escalationFeedback?.success && <p role="status" className="mt-3 text-xs text-emerald-700">{escalationFeedback.success}</p>}
            {workflowStages.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-500">
                    {currentStage
                      ? `${copy.stage} ${activeStage + 1} ${copy.of} ${workflowStages.length}`
                      : `${completedStages} of ${workflowStages.length} stages completed`}
                  </span>
                  <span className="font-semibold text-slate-800">
                    {progress === null ? "—" : `${progress}% ${copy.complete}`}
                  </span>
                </div>
                <div className="flex h-2 gap-1 overflow-hidden rounded-full bg-slate-100">
                  {workflowStages.map((stage, index) => {
                    const status = stageStatus(stage).toLowerCase();
                    const isComplete = status.includes("complete") || status.includes("deliver");
                    const segmentTone = isComplete
                      ? "bg-emerald-600"
                      : index === activeStage
                        ? "bg-sky-600"
                        : "bg-slate-200";
                    return <span key={stage.id ?? `${stage.order ?? index}-${index}`} className={`h-full min-w-0 flex-1 ${segmentTone}`} />;
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="grid min-h-140 gap-4 xl:grid-cols-[minmax(220px,0.85fr)_minmax(320px,1.35fr)_minmax(240px,0.9fr)]">
            <aside className="max-h-[calc(100vh-12rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {isUnimodal ? copy.unimodalWorkflow : copy.multimodalWorkflow}
              </p>
              {workflowStages.length ? (
                <ol className="mt-4 space-y-1">
                  {workflowStages.map((stage, index) => {
                    const status = stageStatus(stage);
                    const selected = activeStage === index;
                    return (
                      <li key={stage.id ?? `${stageName(stage, index)}-${index}`}>
                        <button
                          type="button"
                          onClick={() => setSelection({ serviceId: id, activeStage: index, activeTab: "stage", stageSelected: true })}
                          className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                            selected ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-slate-50"
                          }`}
                        >
                          <span className="mt-0.5">{stageIcon(status, selected)}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-slate-900">
                              <span className="mr-2 font-mono text-xs font-medium text-slate-400">{String(stage.order ?? index + 1).padStart(2, "0")}</span>
                              {localizedStageName(stage, index)}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">{localizedStageStatus(status)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No workflow stages were returned by the API.
                </p>
              )}
            </aside>

            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.stageWorkspace}</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">
                    {currentStage ? localizedStageName(currentStage, activeStage) : "Service details"}
                  </h2>
                </div>
                {currentStage && (
                  <span className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${stageTone(currentStageStatus)}`}>
                    {currentStageStatusLabel}
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {([
                  ["stage", copy.stageWork, null],
                  ["documents", copy.documents, service.documents.length],
                  ["discussion", copy.discussion, stageDiscussions.length || currentStage?.discussionCount || 0],
                  ["consignment", copy.consignment, null],
                ] as const).map(([tab, label, count]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSelection({
                      serviceId: id,
                      activeStage,
                      activeTab: tab,
                      stageSelected: hasManualStageSelection,
                    })}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                      activeTab === tab
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {label}{count === null ? "" : ` (${count})`}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-4">
                {activeTab === "documents" ? (
                  <div className="space-y-3">
                    {documentActionError && (
                      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {documentActionError}
                      </p>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setSelection({
                            serviceId: id,
                            activeStage,
                            activeTab: "stage",
                            stageSelected: hasManualStageSelection,
                          });
                          window.setTimeout(() => stageFileInput.current?.click(), 0);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                        Upload document
                      </button>
                    </div>
                    <DocumentsPanel
                      documents={service.documents}
                      error={documentsError}
                      actionBusy={documentActionBusy}
                      onPreview={(document) => void previewServiceDocument(document)}
                      onDownload={(document) => void downloadServiceDocument(document)}
                    />
                  </div>
                ) : activeTab === "discussion" ? (
                  <div className="space-y-4">
                    {stageDiscussionsError && (
                      <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        Unable to load stage discussion: {stageDiscussionsError}
                      </p>
                    )}
                    {stageDiscussionsLoading ? (
                      <p role="status" className="text-sm text-slate-500">Loading stage discussion...</p>
                    ) : stageDiscussions.length ? (
                      <ul className="space-y-3">
                      {stageDiscussions.map((message) => (
                        <li key={message.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <MessageSquare className="h-4 w-4 text-slate-500" />
                              Stage discussion
                            </div>
                            <time className="shrink-0 text-xs text-slate-500">{formatDate(message.createdAt || undefined)}</time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{message.comment || "No comment content."}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {message.author || "Author unavailable"}{message.role ? ` · ${message.role}` : ""}
                          </p>
                        </li>
                      ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                        No discussion messages were returned for this stage.
                      </p>
                    )}
                    <form onSubmit={(event) => void submitStageDiscussion(event)} className="space-y-3 rounded-xl border border-slate-200 p-4">
                      <label className="block text-xs font-medium text-slate-700">
                        Add a stage message
                        <textarea
                          value={discussionDraft}
                          onChange={(event) => setDiscussionDraft(event.target.value)}
                          rows={3}
                          maxLength={2000}
                          disabled={discussionSubmitting || discussionStageId === null}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                        />
                      </label>
                      {discussionFeedback?.error && <p role="alert" className="text-sm text-red-700">{discussionFeedback.error}</p>}
                      {discussionFeedback?.success && <p role="status" className="text-sm text-emerald-700">{discussionFeedback.success}</p>}
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={discussionSubmitting || !discussionDraft.trim() || discussionStageId === null}
                          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                        >
                          {discussionSubmitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          {discussionSubmitting ? "Sending..." : "Add message"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : activeTab === "consignment" ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-sm font-medium text-slate-800">{copy.consignment}</p>
                    {consignmentLoading ? (
                      <p role="status" className="mt-3 text-sm text-slate-500">Loading consignment details...</p>
                    ) : (
                      <>
                        {consignmentError && (
                          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            Unable to load consignment details: {consignmentError}
                          </p>
                        )}
                        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                          <DetailField label="Description" value={consignmentDetails?.description || service.description || "—"} />
                          <DetailField label={copy.origin} value={consignmentDetails?.countryOfOrigin || consignmentDetails?.origin || service.countryOfOrigin || service.origin || "—"} />
                          <DetailField label={copy.destination} value={consignmentDetails?.destination || service.destination || service.routeCategory || "—"} />
                          <DetailField
                            label="Declared value"
                            value={consignmentDetails?.declaredValue === null || consignmentDetails?.declaredValue === undefined
                              ? service.declaredValue === null || service.declaredValue === undefined
                                ? "—"
                                : String(service.declaredValue)
                              : String(consignmentDetails.declaredValue)}
                          />
                          <DetailField label="Tax category" value={consignmentDetails?.taxCategory || service.taxCategory || "—"} />
                          <DetailField label="TIN" value={service.importer?.tin || "—"} />
                          <DetailField label={copy.mode} value={modeLabel} />
                          <DetailField label="Carrier / vessel / flight" value={logisticsCarrier} />
                          <DetailField label="Container / reference" value={String(service.containerNumber ?? service.reference_number ?? "—")} />
                          <DetailField label="ETA" value={formatDateOnly(service.estimated_arrival || service.eta)} />
                          <DetailField label="Registered" value={formatDate(consignmentDetails?.registeredDate || service.createAt)} />
                        </dl>
                      </>
                    )}
                  </div>
                ) : (
                  currentStage ? (
                    <div className="space-y-4">
                      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        {previousStage ? (
                          <>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">{copy.previousStageSummary}</h3>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{copy.carriedForwardContext}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-700">
                              {previousStageSummary?.stageName
                                ? formatActivityLabel(previousStageSummary.stageName)
                                : localizedStageName(previousStage, activeStage - 1)}
                            </p>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stageTone(previousStageSummaryStatus)}`}>
                              {localizedStageStatus(previousStageSummaryStatus)}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                            {previousStageSummaryNote || "No summary or carried-over note is available."}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            {previousStageSummaryStatus.toLowerCase().includes("complete")
                              ? `Completed ${formatDate(previousStageSummary?.completedAt || previousStage.completedAt || previousStage.updatedAt || previousStage.updated_at)} · took ${
                                  previousStageSummary?.durationHours !== null && previousStageSummary?.durationHours !== undefined
                                    ? formatDurationHours(previousStageSummary.durationHours)
                                    : formatDuration(previousStage.startedAt || previousStage.createdAt, previousStage.completedAt || previousStage.updatedAt)
                                } · ${previousStageSummary?.completedByName || personName(service.assignedCaseExecutor)}`
                              : `In flight · ${personName(service.assignedCaseExecutor)}`}
                          </p>
                          </>
                        ) : (
                          <>
                            <h3 className="text-sm font-semibold text-slate-900">{copy.previousStageSummary}</h3>
                            <p className="mt-2 text-sm text-slate-500">No previous stage summary is available.</p>
                          </>
                        )}
                      </section>
                      <section className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">{copy.requiredDocuments}</h3>
                            <span className="text-xs text-slate-500">
                              {requiredStageDocuments.filter((document) =>
                                document.documentId !== null || document.status.toLowerCase() === "received",
                              ).length} of {requiredStageDocuments.length} received
                            </span>
                          </div>
                          {documentsError && (
                            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                              Unable to load stage documents: {documentsError}
                            </p>
                          )}
                          {requiredStageDocuments.length ? (
                            <ul className="mt-3 divide-y divide-slate-100">
                              {requiredStageDocuments.map((document, index) => {
                                const received = document.documentId !== null
                                  || document.status.toLowerCase() === "received";
                                return (
                                  <li key={`${document.documentType}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                    <span className="text-sm text-slate-700">{document.documentType}</span>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                      received ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                                    }`}>
                                      {received ? copy.received : copy.outstanding}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm text-slate-500">No required documents were returned for this stage.</p>
                          )}
                        </section>
                      <section className="rounded-xl border border-slate-200 p-4">
                        <input
                          ref={stageFileInput}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.xlsx"
                          className="hidden"
                          disabled={stageUploadBusy || !hasCurrentStageDocumentId}
                          onChange={(event) => selectStageFile(event.target.files?.[0] ?? null)}
                        />
                        <div
                          onDragEnter={(event) => {
                            event.preventDefault();
                            setIsDraggingFile(true);
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDragLeave={(event) => {
                            if (event.currentTarget === event.target) setIsDraggingFile(false);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setIsDraggingFile(false);
                            selectStageFile(event.dataTransfer.files[0] ?? null);
                          }}
                          className={`flex min-h-44 flex-col items-center justify-center rounded-md border border-dashed p-5 text-center transition-colors ${
                            isDraggingFile ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"
                          }`}
                        >
                          <UploadCloud className="h-7 w-7 text-slate-500" />
                          <h3 className="mt-2 text-sm font-semibold text-slate-900">Attach stage documents</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {copy.uploadDescription}
                          </p>
                          {!hasCurrentStageDocumentId && (
                            <p className="mt-2 text-xs text-amber-700">
                              Uploads are unavailable until the API returns a workflow stage ID.
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => stageFileInput.current?.click()}
                            disabled={stageUploadBusy || !hasCurrentStageDocumentId}
                            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                          >
                            {stageUploadBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                            {stageUploadBusy ? `Uploading ${uploadProgress ?? 0}%` : copy.browseFiles}
                          </button>
                        </div>
                        <label className="mt-3 block text-xs font-medium text-slate-700">
                          {copy.documentType}
                          <select
                            value={currentDocumentType}
                            onChange={(event) => setDocumentType(event.target.value)}
                            disabled={stageUploadBusy}
                            className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800"
                          >
                            {stageDocumentTypes.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </label>
                        {stageUploadBusy && (
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={uploadProgress ?? 0} aria-valuemin={0} aria-valuemax={100}>
                            <span className="block h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress ?? 0}%` }} />
                          </div>
                        )}
                        {selectedStageFile && (
                          <p className="mt-3 truncate text-sm text-slate-700">
                            Selected: <span className="font-medium">{selectedStageFile.name}</span>
                          </p>
                        )}
                        {currentStageUploadFeedback?.error && (
                          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-700">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {currentStageUploadFeedback.error}
                          </p>
                        )}
                        {currentStageUploadFeedback?.success && (
                          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            {currentStageUploadFeedback.success}
                          </p>
                        )}
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void uploadStageFile()}
                            disabled={!selectedStageFile || stageUploadBusy || !hasCurrentStageDocumentId}
                            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {stageUploadBusy ? "Uploading..." : "Upload document"}
                          </button>
                        </div>
                      </section>
                      <dl className="grid gap-4 rounded-xl border border-slate-200 px-4 py-3 sm:grid-cols-3">
                        <DetailField label="Created" value={formatDate(currentStage.createdAt)} />
                        <DetailField label="Last updated" value={formatDate(currentStage.updatedAt || currentStage.updated_at)} />
                        <DetailField label="Completed" value={formatDate(currentStage.completedAt)} />
                      </dl>
                      {(currentStage.notes || currentStage.comments) && (
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stage note</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                            {currentStage.notes || currentStage.comments}
                          </p>
                        </div>
                      )}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitStageUpdate(stageStatusDraft);
                        }}
                        className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{copy.updateStage}</h3>
                          <p className="mt-1 text-xs text-slate-500">{copy.auditTrail}</p>
                        </div>
                        {!hasCurrentStageExecution && (
                          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                            Stage update is unavailable until the service API returns a workflow stage ID.
                          </p>
                        )}
                        <label className="block text-xs font-medium text-slate-700">
                          {copy.stageStatus}
                          <select
                            value={stageStatusDraft}
                            disabled={stageSaving || !hasCurrentStageExecution}
                            onChange={(event) => {
                              setStageFeedback(null);
                              setStageDrafts((drafts) => ({
                                ...drafts,
                                [stageDraftKey]: {
                                  status: event.target.value,
                                  notes: stageNotesDraft,
                                  riskChannel: stageRiskDraft,
                                },
                              }));
                            }}
                            className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="NotStarted">{localizedStageStatus("Not started")}</option>
                            <option value="InProgress">{localizedStageStatus("In progress")}</option>
                            <option value="NeedsReview">{localizedStageStatus("Needs review")}</option>
                            <option value="RequiresCustomerAction">{localizedStageStatus("Requires customer action")}</option>
                            <option value="Completed">{localizedStageStatus("Completed")}</option>
                            <option value="Blocked">{localizedStageStatus("Blocked")}</option>
                          </select>
                        </label>
                        <label className="block text-xs font-medium text-slate-700">
                          {copy.riskChannel}
                          <select
                            value={stageRiskDraft}
                            disabled={stageSaving || !hasCurrentStageExecution}
                            onChange={(event) => {
                              setStageFeedback(null);
                              setStageDrafts((drafts) => ({
                                ...drafts,
                                [stageDraftKey]: {
                                  status: stageStatusDraft,
                                  notes: stageNotesDraft,
                                  riskChannel: event.target.value,
                                },
                              }));
                            }}
                            className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Select risk channel</option>
                            <option value="green">{copy.greenRisk}</option>
                            <option value="yellow">{copy.yellowRisk}</option>
                            <option value="blue">{copy.blueRisk}</option>
                            <option value="red">{copy.redRisk}</option>
                          </select>
                        </label>
                        <label className="block text-xs font-medium text-slate-700">
                          {copy.stageNote}
                          <textarea
                            value={stageNotesDraft}
                            disabled={!hasCurrentStageExecution}
                            onChange={(event) => {
                              setStageFeedback(null);
                              setStageDrafts((drafts) => ({
                                ...drafts,
                                [stageDraftKey]: {
                                  status: stageStatusDraft,
                                  notes: event.target.value,
                                  riskChannel: stageRiskDraft,
                                },
                              }));
                            }}
                            maxLength={2000}
                            rows={3}
                            placeholder={copy.stageNotePlaceholder}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </label>
                        {activeStageFeedback?.error && <p role="alert" className="text-xs text-red-700">{activeStageFeedback.error}</p>}
                        {activeStageFeedback?.success && <p role="status" className="text-xs text-emerald-700">{activeStageFeedback.success}</p>}
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="submit"
                            disabled={stageSaving || !hasCurrentStageExecution}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            {stageSaving ? "Saving..." : copy.saveDraft}
                          </button>
                          <button
                            type="button"
                            onClick={() => void submitStageUpdate("Completed", true)}
                            disabled={stageSaving || !hasCurrentStageExecution}
                            className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                          >
                            {copy.saveAdvance}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Mark this stage as blocked and submit an escalation?")) {
                                void submitStageUpdate("Blocked");
                              }
                            }}
                            disabled={stageSaving || !hasCurrentStageExecution}
                            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            {copy.markBlocked}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <p className="text-sm font-medium text-slate-800">Service overview</p>
                      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                        <DetailField label="Description" value={service.description || "—"} />
                        <DetailField label="Service status" value={formatStatus(service.status)} />
                        <DetailField label="Service mode" value={modeLabel} />
                        <DetailField label="Registered" value={formatDate(service.createAt)} />
                        <DetailField label="Declared value" value={service.declaredValue === null || service.declaredValue === undefined ? "—" : String(service.declaredValue)} />
                        <DetailField label="Tax category" value={service.taxCategory || "—"} />
                      </dl>
                    </div>
                  )
                )}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.importer}</p>
                <h2 className="mt-2 text-sm font-semibold text-slate-900">{importer}</h2>
                <p className="mt-1 break-all text-xs text-slate-500">
                  {service.importer?.customer_code || "—"} · {copy.tin} {service.importer?.tin || "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {service.importer?.contact_person || "—"} · {service.importer?.phone || "—"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMessageImporterMode(true);
                    setShowNotification(true);
                    setNotificationFeedback(null);
                  }}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {copy.messageImporter}
                </button>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.assignedStaff}</p>
                <div className="mt-3 space-y-3">
                  {assignedStaff.map(([role, staffMember]) => {
                    const staffName = personName(staffMember);
                    return (
                      <div key={role} className="flex items-center gap-3">
                        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {staffName === "Not assigned"
                            ? "—"
                            : staffName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                          {staffName !== "Not assigned" && staffMember?.is_active !== false && (
                            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{staffName}</p>
                          <p className="text-xs text-slate-500">{staffMember?.role || role}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <label htmlFor="case-executor" className="block text-xs font-medium text-slate-600">
                    {copy.assignCaseExecutor}
                  </label>
                  <select
                    id="case-executor"
                    value={selectedExecutorId}
                    onChange={(event) => setExecutorSelection({
                      serviceId: id,
                      executorId: event.target.value,
                    })}
                    disabled={staffLoading || assigningExecutor}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    <option value="">{copy.selectCaseExecutor}</option>
                    {eligibleExecutors.map((member) => (
                      <option key={member.id} value={member.id}>
                        {personName(member)}
                      </option>
                    ))}
                  </select>
                  {staffError && <p role="alert" className="text-xs text-red-700">{staffError}</p>}
                  {assignmentFeedback?.error && (
                    <p role="alert" className="text-xs text-red-700">{assignmentFeedback.error}</p>
                  )}
                  {assignmentFeedback?.success && (
                    <p role="status" className="text-xs text-emerald-700">{assignmentFeedback.success}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void assignCaseExecutor()}
                    disabled={!selectedExecutorId || staffLoading || assigningExecutor}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {assigningExecutor && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    {assigningExecutor ? copy.assigning : copy.assignExecutor}
                  </button>
                  <label htmlFor="service-assessor" className="block pt-2 text-xs font-medium text-slate-600">
                    {copy.assignAssessor}
                  </label>
                  <select
                    id="service-assessor"
                    value={selectedAssessorId}
                    onChange={(event) => setAssessorSelection({
                      serviceId: id,
                      assessorId: event.target.value,
                    })}
                    disabled={staffLoading || assigningAssessor}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    <option value="">{copy.selectAssessor}</option>
                    {eligibleAssessors.map((member) => (
                      <option key={member.id} value={member.id}>{personName(member)}</option>
                    ))}
                  </select>
                  {assessorAssignmentFeedback?.error && (
                    <p role="alert" className="text-xs text-red-700">{assessorAssignmentFeedback.error}</p>
                  )}
                  {assessorAssignmentFeedback?.success && (
                    <p role="status" className="text-xs text-emerald-700">{assessorAssignmentFeedback.success}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void assignServiceAssessor()}
                    disabled={!selectedAssessorId || staffLoading || assigningAssessor}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {assigningAssessor && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    {assigningAssessor ? copy.assigning : copy.assignAssessor}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.riskCompliance}</p>
                </div>
                <p className="mt-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">{riskLabel}</p>
                {riskDescription && <p className="mt-2 text-xs leading-5 text-slate-600">{riskDescription}</p>}
                {service.isBlocked && <p className="mt-2 text-xs font-medium text-red-700">This service is blocked.</p>}
                {service.requiresCustomerAction && <p className="mt-2 text-xs font-medium text-amber-700">Customer action is required.</p>}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  {mode === "Unimodal" ? <Truck className="h-4 w-4 text-slate-500" /> : <MapPin className="h-4 w-4 text-slate-500" />}
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.logistics}</p>
                </div>
                <dl className="mt-3 space-y-3">
                  <DetailField label={copy.carrier} value={logisticsCarrier} />
                  <DetailField label={copy.origin} value={service.origin || service.countryOfOrigin || "—"} />
                  <DetailField label={copy.destination} value={service.destination || "—"} />
                  <DetailField label="Route category" value={service.routeCategory || service.route_summary || "—"} />
                  <DetailField label="ETA" value={formatDateOnly(service.estimated_arrival || service.eta)} />
                </dl>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy.recentActivity}</p>
                </div>
                {serviceActivitiesError && (
                  <p role="alert" className="mt-3 text-xs text-red-700">
                    Unable to load activities: {serviceActivitiesError}
                  </p>
                )}
                {displayedActivities.length ? (
                  <ol className="mt-3 space-y-3">
                    {displayedActivities.map((activity, index) => (
                      <li key={`${activity.date}-${activity.label}-${index}`} className="border-l-2 border-slate-200 pl-3">
                        <p className="text-xs font-medium text-slate-700">
                          › {formatActivityLabel(activity.label)}
                          {"actorName" in activity && activity.actorName ? ` · ${activity.actorName}` : ""}
                        </p>
                        <time className="mt-0.5 block text-[11px] text-slate-500">{formatRelativeTime(activity.date)}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No service activity was returned.</p>
                )}
              </section>
            </aside>
          </section>
        </>
      )}
      {showEscalation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="escalation-title"
            onSubmit={(event) => void submitEscalation(event)}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="escalation-title" className="text-lg font-semibold text-slate-900">{copy.escalate} service</h2>
                <p className="mt-1 text-sm text-slate-500">Provide the reason to submit this escalation to the manager service.</p>
              </div>
              <button type="button" aria-label="Close escalation" onClick={() => setShowEscalation(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Escalation reason
              <textarea
                required
                value={escalationReason}
                onChange={(event) => setEscalationReason(event.target.value)}
                maxLength={2000}
                rows={4}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {escalationFeedback?.error && <p role="alert" className="text-sm text-red-700">{escalationFeedback.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowEscalation(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                {copy.cancel}
              </button>
              <button type="submit" disabled={escalationSubmitting || !escalationReason.trim()} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {escalationSubmitting ? "Submitting..." : copy.submitEscalation}
              </button>
            </div>
          </form>
        </div>
      )}
      {showNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-title"
            onSubmit={(event) => void submitImporterNotification(event)}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="notification-title" className="text-lg font-semibold text-slate-900">
                  {messageImporterMode ? copy.messageImporter : copy.notifyImporter}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{importer}</p>
              </div>
              <button type="button" aria-label="Close notification" onClick={() => setShowNotification(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Subject
              <input
                value={notificationType}
                onChange={(event) => setNotificationType(event.target.value)}
                maxLength={100}
                placeholder="Service update"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Message
              <textarea
                ref={importerMessageRef}
                required
                value={notificationMessage}
                onChange={(event) => setNotificationMessage(event.target.value)}
                rows={5}
                maxLength={2000}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {notificationFeedback?.error && <p role="alert" className="text-sm text-red-700">{notificationFeedback.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNotification(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                {copy.cancel}
              </button>
              <button type="submit" disabled={notificationSubmitting || !notificationMessage.trim()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {notificationSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {notificationSubmitting ? "Sending..." : copy.send}
              </button>
            </div>
          </form>
        </div>
      )}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="document-preview-title" className="flex h-[min(90vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 id="document-preview-title" className="truncate text-sm font-semibold text-slate-900">{previewName}</h2>
              <button type="button" aria-label="Close preview" onClick={() => setPreviewUrl(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </header>
            <iframe title={previewName} src={previewUrl} className="min-h-0 flex-1" />
          </section>
        </div>
      )}
      {actionNotice && (
        <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[60] flex max-w-sm items-center gap-3 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{actionNotice}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setActionNotice("")} className="rounded p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </main>
  );
}