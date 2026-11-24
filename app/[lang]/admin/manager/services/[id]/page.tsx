"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  MapPin,
  MessageSquare,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  UploadCloud,
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

type DetailTab = "stage" | "documents" | "discussion" | "consignment";

const formatStatus = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "Status unavailable";
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const normalized = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, "");
    const knownLabels: Record<string, string> = {
      needsreview: "Needs review",
      inprogress: "In progress",
      notstarted: "Not started",
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

  const unimodalStages = ["localpermission", "arrival", "clearancerequest"].flatMap((name) => {
    const stage = stageByName.get(name);
    return stage ? [stage] : [];
  });

  return unimodalStages.length ? unimodalStages : stages;
};

const stageStatus = (stage: ManagerServiceStage): string => {
  const value = stage.status ?? stage.apiStatus ?? stage.stageStatus ?? stage.currentStatus;
  const normalizedStatusLabels: Record<ManagerWorkflowStageStatus, string> = {
    completed: "Completed",
    needs_review: "Needs review",
    in_progress: "In progress",
    not_started: "Not started",
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
    };
    return knownStatuses[Number(value)] ?? `Status ${value}`;
  }
  return formatStatus(value);
};

const stageStatusOption = (status: string): string => {
  const normalized = status.toLowerCase().replaceAll(/[\s_-]+/g, "");
  if (normalized.includes("complete") || normalized.includes("deliver")) return "Completed";
  if (normalized.includes("block")) return "Blocked";
  if (normalized.includes("review")) return "NeedsReview";
  if (normalized.includes("progress") || normalized.includes("active")
    || normalized.includes("notstarted") || normalized.includes("draft")) return "Pending";
  return "Pending";
};

const riskChannelOption = (service: ManagerServiceDetail | null): string => {
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

const riskLevelForChannel = (channel: string): number | undefined => {
  const levels: Record<string, number> = { blue: 1, green: 2, yellow: 3, red: 4 };
  return levels[channel];
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
  if (normalized.includes("progress") || normalized.includes("active")) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (normalized.includes("review") || normalized.includes("block")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const stageIcon = (status: string, isActive = false) => {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("deliver")) {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  }
  if (isActive || normalized.includes("review")) {
    return <Search className={`h-5 w-5 ${normalized.includes("review") ? "text-amber-600" : "text-sky-600"}`} />;
  }
  if (normalized.includes("progress") || normalized.includes("active")) {
    return <Clock3 className="h-5 w-5 text-sky-600" />;
  }
  return <Circle className="h-5 w-5 text-slate-400" />;
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
}: {
  documents: ManagerServiceDocument[];
  error: string | null;
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
          const name = document.originalFileName || document.fileName || `Document ${index + 1}`;
          const verified = document.isVerified;
          return (
            <li key={document.id ?? `${name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{document.documentType || document.mimeType || "Document"} · {formatDate(document.createAt)}</p>
                </div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                verified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}>
                {verified ? "Verified" : "Awaiting verification"}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function ManagerServiceDetailPage() {
  const { id, lang } = useParams<{ id: string; lang: string }>();
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
  const escalateService = useManagerStore((state) => state.escalateService);
  const staff = useManagerStore((state) => state.staff);
  const staffLoading = useManagerStore((state) => state.staffLoading);
  const staffError = useManagerStore((state) => state.staffError);
  const fetchStaff = useManagerStore((state) => state.fetchStaff);
  const assignExecutor = useManagerStore((state) => state.assignExecutor);
  const updateServiceStage = useManagerStore((state) => state.updateServiceStage);
  const uploadServiceDocument = useManagerStore((state) => state.uploadServiceDocument);
  const [refreshing, setRefreshing] = useState(false);
  const [executorSelection, setExecutorSelection] = useState<{
    serviceId: string;
    executorId: string;
  } | null>(null);
  const [assigningExecutor, setAssigningExecutor] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const [stageUpload, setStageUpload] = useState<{ stageKey: string; file: File } | null>(null);
  const [stageUploadBusy, setStageUploadBusy] = useState(false);
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
  const [notificationFeedback, setNotificationFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);
  const importerMessageRef = useRef<HTMLTextAreaElement | null>(null);
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
  const currentExecutorId = String(service?.assignedCaseExecutorId ?? "");
  const selectedExecutorId = executorSelection?.serviceId === id
    ? executorSelection.executorId
    : eligibleExecutors.some((member) => String(member.id) === currentExecutorId)
      ? currentExecutorId
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
  const currentStageExecutionId = currentStage?.stageExecutionId
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
  const stageRiskDraft = stageDrafts[stageDraftKey]?.riskChannel ?? riskChannelOption(service);
  const activeStageFeedback = stageFeedback?.stageKey === stageDraftKey ? stageFeedback : null;
  const selectedStageFile = stageUpload?.stageKey === stageDraftKey ? stageUpload.file : null;
  const currentStageUploadFeedback = stageUploadFeedback?.stageKey === stageDraftKey
    ? stageUploadFeedback
    : null;

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
  const completedStages = workflowStages.filter((stage) => {
    const status = stageStatus(stage).toLowerCase();
    return status.includes("complete") || status.includes("deliver");
  }).length;
  const progress = workflowStages.length
    ? Math.round(((activeStage + 1) / workflowStages.length) * 100)
    : null;
  const previousStage = activeStage > 0 ? workflowStages[activeStage - 1] : null;
  const stageDocuments = currentStage?.documents?.length
    ? currentStage.documents
    : service?.documents.filter(
        (document) =>
          document.stageId !== null &&
          document.stageId !== undefined &&
          [currentStage?.id, currentStage?.serviceStageId, currentStage?.stageExecutionId, currentStage?.serviceStageExecutionId, currentStage?.executionId]
            .some((stageId) => stageId !== undefined && String(document.stageId) === String(stageId)),
      ) ?? [];
  const recentActivity = service?.stages
    .flatMap((stage, index) => {
      const name = displayStageName(stage, index);
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
  const displayedActivities = serviceActivities.length
    ? serviceActivities.map((activity) => ({ label: activity.label, date: activity.date ?? "" }))
    : recentActivity;

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
    const stageExecutionId = getPositiveIntegerId(currentStageExecutionId);
    if (
      !service ||
      serviceIdentifier === null ||
      shipmentId === null ||
      stageExecutionId === null
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
      shipmentId,
      shipmentStageId: stageExecutionId,
      status,
      notes: stageNotesDraft.trim(),
      riskLevel: riskLevelForChannel(stageRiskDraft),
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
      setDiscussionDraft("");
      setDiscussionFeedback({ success: "Discussion comment added." });
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
      await notifyImporter({
        serviceId: serviceIdentifier,
        subject: notificationType.trim() || "Service update",
        message: notificationMessage.trim(),
      });
      setNotificationType("");
      setNotificationMessage("");
      setNotificationFeedback({ success: "Importer notification sent." });
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
      setEscalationReason("");
      setShowEscalation(false);
      setEscalationFeedback({ success: "Service escalation submitted." });
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

    const acceptedFile = /\.(pdf|jpg|png|xlsx)$/i.test(file.name);
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
    formData.append("ShipmentId", String(shipmentId));
    formData.append("StageId", String(stageId));
    formData.append("DocumentType", "10");
    formData.append("Description", `Uploaded for ${displayStageName(currentStage, activeStage)}`);

    setStageUploadBusy(true);
    setStageUploadFeedback({ stageKey: stageDraftKey });
    try {
      await uploadServiceDocument(formData);
      setStageUpload(null);
      setStageUploadFeedback({
        stageKey: stageDraftKey,
        success: `${selectedStageFile.name} uploaded successfully.`,
      });
      if (stageFileInput.current) stageFileInput.current.value = "";
      await fetchServiceById(id);
    } catch (uploadError: unknown) {
      setStageUploadFeedback({
        stageKey: stageDraftKey,
        error: uploadError instanceof Error ? uploadError.message : "Unable to upload this document.",
      });
    } finally {
      setStageUploadBusy(false);
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

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 text-slate-800">
      <Link
        href={`/${lang}/admin/manager/services`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to services
      </Link>

      {loading && !service && (
        <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading service details...
        </p>
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
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {currentStage ? currentStageStatus : formatStatus(service.status)}
                  </span>
                  <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${riskTone(risk)}`}>
                    {risk}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {mode}
                  </span>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {service.cargo_description || service.description || "Service description unavailable"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {importer} · {service.route_summary || [service.origin, service.destination].filter(Boolean).join(" → ") || "Route unavailable"}
                    {(service.estimated_arrival || service.eta) ? ` · ETA ${formatDate(service.estimated_arrival || service.eta)}` : ""}
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
                  Escalate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    importerMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    importerMessageRef.current?.focus();
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Notify importer
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
            {showEscalation && (
              <form onSubmit={(event) => void submitEscalation(event)} className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <label className="block text-xs font-medium text-slate-700">
                  Escalation reason
                  <textarea
                    value={escalationReason}
                    onChange={(event) => setEscalationReason(event.target.value)}
                    maxLength={2000}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                {escalationFeedback?.error && <p role="alert" className="text-xs text-red-700">{escalationFeedback.error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowEscalation(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                    Cancel
                  </button>
                  <button type="submit" disabled={escalationSubmitting || !escalationReason.trim()} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60">
                    {escalationSubmitting ? "Submitting..." : "Submit escalation"}
                  </button>
                </div>
              </form>
            )}
            {escalationFeedback?.success && <p role="status" className="mt-3 text-xs text-emerald-700">{escalationFeedback.success}</p>}
            {workflowStages.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-500">
                    {currentStage
                      ? `Stage ${activeStage + 1} of ${workflowStages.length}`
                      : `${completedStages} of ${workflowStages.length} stages completed`}
                  </span>
                  <span className="font-semibold text-slate-800">{progress === null ? "—" : `${progress}%`}</span>
                </div>
                <div className="flex h-2 gap-1 overflow-hidden rounded-full bg-slate-100">
                  {workflowStages.map((stage, index) => {
                    const segmentTone = index < activeStage
                      ? "bg-emerald-600"
                      : index === activeStage
                        ? "bg-amber-500"
                        : "bg-slate-200";
                    return <span key={stage.id ?? `${stage.order ?? index}-${index}`} className={`h-full min-w-0 flex-1 ${segmentTone}`} />;
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="grid min-h-140 gap-4 xl:grid-cols-[minmax(220px,0.85fr)_minmax(320px,1.35fr)_minmax(240px,0.9fr)]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {isUnimodal ? "Unimodal workflow" : "Multimodal workflow"}
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
                              {displayStageName(stage, index)}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">{status}</span>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Stage workspace</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">
                    {currentStage ? displayStageName(currentStage, activeStage) : "Service details"}
                  </h2>
                </div>
                {currentStage && (
                  <span className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${stageTone(currentStageStatus)}`}>
                    {currentStageStatus}
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {([
                  ["stage", "Stage work", null],
                  ["documents", "Documents", service.documents.length],
                  ["discussion", "Discussion", stageDiscussions.length],
                  ["consignment", "Consignment", null],
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
                  <DocumentsPanel documents={service.documents} error={documentsError} />
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
                            {message.author || "Author unavailable"}
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
                    <p className="text-sm font-medium text-slate-800">Consignment details</p>
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
                          <DetailField label="Origin" value={consignmentDetails?.countryOfOrigin || consignmentDetails?.origin || service.countryOfOrigin || service.origin || "—"} />
                          <DetailField label="Destination" value={consignmentDetails?.destination || service.destination || service.routeCategory || "—"} />
                          <DetailField
                            label="Declared value"
                            value={consignmentDetails?.declaredValue === null || consignmentDetails?.declaredValue === undefined
                              ? service.declaredValue === null || service.declaredValue === undefined
                                ? "—"
                                : String(service.declaredValue)
                              : String(consignmentDetails.declaredValue)}
                          />
                          <DetailField label="Tax category" value={consignmentDetails?.taxCategory || service.taxCategory || "—"} />
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
                          <h3 className="text-sm font-semibold text-slate-900">Previous stage summary</h3>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-700">
                              {displayStageName(previousStage, activeStage - 1)}
                            </p>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stageTone(stageStatus(previousStage))}`}>
                              {stageStatus(previousStage)}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                            {previousStage.notes || previousStage.comments || "No summary or carried-over note is available."}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            Last updated {formatDate(previousStage.updated_at || previousStage.updatedAt || previousStage.completedAt || previousStage.createdAt)}
                          </p>
                          </>
                        ) : (
                          <>
                            <h3 className="text-sm font-semibold text-slate-900">Previous stage summary</h3>
                            <p className="mt-2 text-sm text-slate-500">No previous stage summary is available.</p>
                          </>
                        )}
                      </section>
                      <section className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">Required documents for this stage</h3>
                            {stageDocuments.length > 0 && (
                              <span className="text-xs text-slate-500">
                                {stageDocuments.filter((document) => document.isVerified).length} of {stageDocuments.length} verified
                              </span>
                            )}
                          </div>
                          {documentsError && (
                            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                              Unable to load stage documents: {documentsError}
                            </p>
                          )}
                          {stageDocuments.length ? (
                            <ul className="mt-3 divide-y divide-slate-100">
                              {stageDocuments.map((document, index) => {
                                const pending = String(document.status ?? "").toLowerCase().includes("pending")
                                  || (!document.fileName && !document.originalFileName && !document.isVerified);
                                return (
                                  <li key={document.id ?? `${document.fileName}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                    <span className="text-sm text-slate-700">
                                      {document.originalFileName || document.fileName || `Document ${index + 1}`}
                                      {document.isRequired ? <span className="ml-2 text-xs text-slate-500">Required</span> : null}
                                    </span>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                      pending ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"
                                    }`}>
                                      {pending ? "Pending" : "Received"}
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
                          accept=".pdf,.jpg,.png,.xlsx"
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
                            Drag files here, or browse. PDF, JPG, PNG, XLSX up to 25 MB each.
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
                            {stageUploadBusy ? "Uploading..." : "Browse files"}
                          </button>
                        </div>
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
                      <div className="space-y-4 rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{displayStageName(currentStage, activeStage)}</h3>
                          <p className="mt-1 text-sm text-slate-500">{stageStatus(currentStage)}</p>
                          </div>
                        </div>
                        {stageIcon(currentStageStatus)}
                      </div>
                      <dl className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                        <DetailField label="Created" value={formatDate(currentStage.createdAt)} />
                        <DetailField label="Last updated" value={formatDate(currentStage.updatedAt)} />
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
                          <h3 className="text-sm font-semibold text-slate-900">Update stage</h3>
                          <p className="mt-1 text-xs text-slate-500">Changes are written to the audit trail.</p>
                        </div>
                        {!hasCurrentStageExecution && (
                          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                            Stage update is unavailable until the service API returns a workflow stage ID.
                          </p>
                        )}
                        <label className="block text-xs font-medium text-slate-700">
                          Stage status
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
                            <option value="NeedsReview">Needs review</option>
                            <option value="Pending">Pending</option>
                            <option value="Completed">Completed</option>
                            <option value="Blocked">Blocked</option>
                          </select>
                        </label>
                        <label className="block text-xs font-medium text-slate-700">
                          Risk channel
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
                            <option value="green">Green — direct release</option>
                            <option value="yellow">Yellow — documentary check</option>
                            <option value="red">Red — physical inspection</option>
                            <option value="blue">Blue — fast track</option>
                          </select>
                        </label>
                        <label className="block text-xs font-medium text-slate-700">
                          Stage note
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
                            placeholder="Describe what was done, any exception found, and the next step."
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </label>
                        {activeStageFeedback?.error && <p role="alert" className="text-xs text-red-700">{activeStageFeedback.error}</p>}
                        {activeStageFeedback?.success && <p role="status" className="text-xs text-emerald-700">{activeStageFeedback.success}</p>}
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="submit"
                            disabled={stageSaving || !hasCurrentStageExecution}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
                          >
                            {stageSaving ? "Saving..." : "Save draft"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void submitStageUpdate("Completed", true)}
                            disabled={stageSaving || !hasCurrentStageExecution}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                          >
                            Save & advance stage
                          </button>
                          <button
                            type="button"
                            onClick={() => void submitStageUpdate("Blocked")}
                            disabled={stageSaving || !hasCurrentStageExecution}
                            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            Mark blocked
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
                        <DetailField label="Service mode" value={mode} />
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
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Importer</p>
                <h2 className="mt-2 text-sm font-semibold text-slate-900">{importer}</h2>
                <p className="mt-1 break-all text-xs text-slate-500">
                  {service.importer?.customer_code || "—"} · TIN {service.importer?.tin || "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {service.importer?.contact_person || "—"} · {service.importer?.phone || "—"}
                </p>
                <form onSubmit={(event) => void submitImporterNotification(event)} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <label className="block text-xs font-medium text-slate-600">
                    Notification type (optional)
                    <input
                      value={notificationType}
                      onChange={(event) => setNotificationType(event.target.value)}
                      maxLength={100}
                      placeholder="e.g. Service update"
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Message
                    <textarea
                      ref={importerMessageRef}
                      value={notificationMessage}
                      onChange={(event) => setNotificationMessage(event.target.value)}
                      rows={3}
                      maxLength={2000}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  {notificationFeedback?.error && <p role="alert" className="text-xs text-red-700">{notificationFeedback.error}</p>}
                  {notificationFeedback?.success && <p role="status" className="text-xs text-emerald-700">{notificationFeedback.success}</p>}
                  <button
                    type="submit"
                    disabled={notificationSubmitting || !notificationMessage.trim()}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {notificationSubmitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    {notificationSubmitting ? "Sending..." : "Notify importer"}
                  </button>
                </form>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Assigned staff</p>
                <div className="mt-3 space-y-3">
                  {assignedStaff.map(([role, staffMember]) => {
                    const staffName = personName(staffMember);
                    return (
                      <div key={role} className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {staffName === "Not assigned"
                            ? "—"
                            : staffName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
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
                    Assign case executor
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
                    <option value="">Select a case executor</option>
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
                    {assigningExecutor ? "Assigning..." : "Assign executor"}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Risk & compliance</p>
                </div>
                <p className="mt-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">{risk}</p>
                {riskDescription && <p className="mt-2 text-xs leading-5 text-slate-600">{riskDescription}</p>}
                {service.isBlocked && <p className="mt-2 text-xs font-medium text-red-700">This service is blocked.</p>}
                {service.requiresCustomerAction && <p className="mt-2 text-xs font-medium text-amber-700">Customer action is required.</p>}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  {mode === "Unimodal" ? <Truck className="h-4 w-4 text-slate-500" /> : <MapPin className="h-4 w-4 text-slate-500" />}
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Logistics</p>
                </div>
                <dl className="mt-3 space-y-3">
                  <DetailField label="Origin" value={service.origin || service.countryOfOrigin || "—"} />
                  <DetailField label="Destination" value={service.destination || "—"} />
                  <DetailField label="Route category" value={service.routeCategory || service.route_summary || "—"} />
                  <DetailField label="Estimated arrival" value={formatDate(service.estimated_arrival || service.eta)} />
                </dl>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Recent activity</p>
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
                        <p className="text-xs font-medium text-slate-700">{activity.label}</p>
                        <time className="mt-0.5 block text-[11px] text-slate-500">{formatDate(activity.date)}</time>
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
    </main>
  );
}