"use client";

import { create } from "zustand";
import { AssessorEndpoints } from "@/modules/assessor/assessor.endpoint";
import { useManagerStore } from "@/modules/manager/manager.store";
import type { ManagerExecutorAssignment, ManagerServiceQuery } from "@/modules/manager/manager.type";
import type { AssessorItem } from "@/modules/assessor/assessor.type";
import type { ServiceColumn, ServiceFiltersState, ServiceRecord } from "./service.types";

const allColumns: ServiceColumn[] = [
  "service",
  "importer",
  "mode",
  "status",
  "risk",
  "caseExecutor",
  "eta",
  "sla",
  "updated",
];

interface ServiceStore extends ServiceFiltersState {
  services: ServiceRecord[];
  visibleColumns: ServiceColumn[];
  loading: boolean;
  error: string | null;
  fetchServices: () => Promise<void>;
  fetchManagerServices: (params?: ManagerServiceQuery) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: string) => void;
  setModeFilter: (mode: string) => void;
  setChannelFilter: (channel: string) => void;
  toggleColumn: (column: ServiceColumn) => void;
  getFilteredServices: () => ServiceRecord[];
}

type ApiRecord = AssessorItem;

const readValue = (record: ApiRecord, ...keys: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    keys.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const readText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
};

const readNestedText = (value: unknown, ...keys: string[]): string => {
  const direct = readText(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as ApiRecord;
  for (const key of keys) {
    const result = readText(readValue(record, key));
    if (result) return result;
  }

  return "";
};

const normalizeRecordList = (value: unknown): ApiRecord[] => {
  if (Array.isArray(value)) {
    if (!value.every((item) => !!item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("The assessor response contains invalid service records.");
    }
    return value as ApiRecord[];
  }
  if (!value || typeof value !== "object") {
    throw new Error("The assessor response did not contain a service record list.");
  }

  const record = value as ApiRecord;
  for (const key of [
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
    "records",
    "rows",
    "pendingServices",
    "pendingServiceReviews",
    "pendingServiceReviewList",
    "pendingReviews",
    "pendingReviewServices",
    "serviceReviewRecords",
    "serviceReviews",
    "reviewQueue",
    "servicesUnderOversight",
    "oversightServices",
    "underOversight",
  ]) {
    const nested = readValue(record, key);
    if (nested !== undefined && nested !== value) {
      const rows = normalizeRecordList(nested);
      if (rows.length || Array.isArray(nested)) return rows;
    }
  }

  if (readValue(record, "id", "shipmentId", "serviceId", "trackingNumber") !== undefined) {
    return [record];
  }

  throw new Error("The assessor response did not contain a service record list.");
};

const normalizeStatus = (value: unknown): ServiceRecord["status"] => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as ApiRecord;
    return normalizeStatus(readValue(record, "value", "id", "code", "name", "label", "status"));
  }

  const statusLabels: Record<number, ServiceRecord["status"]> = {
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
  if (Number.isInteger(numeric) && statusLabels[numeric]) return statusLabels[numeric];
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, "");
    const textLabels: Record<string, ServiceRecord["status"]> = {
      draft: "Draft",
      submitted: "Submitted",
      underreview: "Under review",
      approved: "Approved",
      inprogress: "In progress",
      needsreview: "Needs review",
      requirescustomeraction: "Requires customer action",
      pending: "Pending",
      blocked: "Blocked",
      completed: "Completed",
      rejected: "Rejected",
      cancelled: "Cancelled",
      delivered: "Delivered",
      deliverd: "Delivered",
    };
    return textLabels[normalized] ?? "Unknown";
  }
  return "Unknown";
};

const normalizeMode = (value: unknown): ServiceRecord["mode"] => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as ApiRecord;
    return normalizeMode(readValue(record, "value", "id", "code", "name", "label", "mode"));
  }

  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    if (Number(value) === 1) return "Multimodal";
    if (Number(value) === 2) return "Unimodal";
    return "Unknown";
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized.includes("multi")) return "Multimodal";
    if (normalized.includes("uni")) return "Unimodal";
  }
  return "Unknown";
};

const normalizeRisk = (value: unknown): ServiceRecord["riskChannel"] => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as ApiRecord;
    return normalizeRisk(readValue(record, "value", "id", "code", "name", "label", "riskLevel", "riskChannel"));
  }

  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const normalized = value.trim().toLowerCase();
    if (normalized.includes("blue")) return "Blue channel";
    if (normalized.includes("green")) return "Green channel";
    if (normalized.includes("yellow")) return "Yellow channel";
    if (normalized.includes("red")) return "Red channel";
    return "Unassigned";
  }

  const riskLabels: Record<number, Exclude<ServiceRecord["riskChannel"], "Unassigned">> = {
    1: "Blue channel",
    2: "Green channel",
    3: "Yellow channel",
    4: "Red channel",
  };
  return riskLabels[Number(value)] ?? "Unassigned";
};

const normalizeRegisterStatus = (item: ApiRecord): ServiceRecord["status"] => {
  const status = normalizeStatus(readValue(item, "status", "shipmentStatus"));
  if (
    status !== "Under review" &&
    status !== "Approved" &&
    status !== "In progress"
  ) {
    return status;
  }

  const stagesValue = readValue(item, "stages", "serviceStages");
  const stages = Array.isArray(stagesValue)
    ? stagesValue.filter(
        (stage): stage is ApiRecord =>
          !!stage && typeof stage === "object" && !Array.isArray(stage),
      )
    : [];
  const hasStageState = (
    statusNumber: number,
    statusName: string,
    flagName?: string,
  ) =>
    stages.some((stage) => {
      const rawStageStatus = readValue(stage, "status", "stageStatus");
      const normalizedStageStatus =
        typeof rawStageStatus === "string"
          ? rawStageStatus.trim().toLowerCase().replaceAll(/[\s_-]+/g, "")
          : "";
      return (
        (flagName !== undefined && readValue(stage, flagName) === true) ||
        Number(rawStageStatus) === statusNumber ||
        normalizedStageStatus === statusName
      );
    });

  if (
    readValue(item, "hasBlockedStage", "isBlocked") === true ||
    hasStageState(5, "blocked", "isBlocked")
  ) {
    return "Blocked";
  }
  if (
    readValue(item, "hasCustomerAction", "requiresCustomerAction") === true ||
    stages.some((stage) => readValue(stage, "requiresCustomerAction") === true)
  ) {
    return "Requires customer action";
  }
  if (
    readValue(item, "hasNeedsReview", "needsReview") === true ||
    hasStageState(6, "needsreview", "needsReview")
  ) {
    return "Needs review";
  }
  if (
    readValue(item, "hasPendingStage", "hasPending") === true ||
    hasStageState(2, "pending", "hasPending")
  ) {
    return "Pending";
  }
  return status;
};

const formatUpdatedDate = (value: unknown): string => {
  const text = readText(value);
  if (!text) return "—";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "—";

  const elapsedMinutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const formatDateOnly = (value: unknown): string => {
  const text = readText(value);
  if (!text) return "ETA unavailable";
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? "ETA unavailable"
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
};

const getSla = (
  dueAt: unknown,
  explicitSla: unknown,
  status: ServiceRecord["status"],
  overdueValue: unknown,
) => {
  const explicitlyOverdue = overdueValue === true || overdueValue === 1 || overdueValue === "true";
  const providedSla = readText(explicitSla);
  if (status === "Completed" || status === "Delivered") {
    return { sla: "Closed", isOverdue: false, daysRemaining: null };
  }

  const dueAtText = readText(dueAt);
  if (dueAtText) {
    const dueDate = new Date(dueAtText);
    if (!Number.isNaN(dueDate.getTime())) {
      const daysRemaining = Math.ceil((dueDate.getTime() - Date.now()) / 86_400_000);
      if (daysRemaining < 0) {
        return { sla: `Overdue ${Math.abs(daysRemaining)}d`, isOverdue: true, daysRemaining };
      }
      if (daysRemaining === 0) return { sla: "Due today", isOverdue: false, daysRemaining };
      return { sla: `${daysRemaining}d left`, isOverdue: explicitlyOverdue, daysRemaining };
    }
  }
  if (providedSla && !/^on[\s_-]*track$/i.test(providedSla)) {
    return {
      sla: providedSla,
      isOverdue: explicitlyOverdue || providedSla.toLowerCase().includes("overdue"),
      daysRemaining: null,
    };
  }
  return { sla: "SLA unavailable", isOverdue: false, daysRemaining: null };
};

const toTimestamp = (value: unknown): number | null => {
  const text = readText(value);
  if (!text) return null;
  const timestamp = new Date(text).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const readDatabaseId = (record: ApiRecord): string => {
  for (const key of [
    "id",
    "shipmentId",
    "serviceId",
    "databaseId",
    "shipmentDatabaseId",
    "serviceDatabaseId",
    "recordId",
  ]) {
    const value = readValue(record, key);
    const text = readText(value);
    const numeric = Number(text);
    if (text && /^\d+$/.test(text) && Number.isSafeInteger(numeric) && numeric > 0) return text;
  }
  return "";
};

const normalizeServiceCode = (record: ApiRecord, databaseId: string): string => {
  const rawCode = readText(readValue(
    record,
    "code",
    "serviceCode",
    "serviceNumber",
    "trackingNumber",
  ));
  if (rawCode && !/^[0-9a-f-]{16,}$/i.test(rawCode)) return rawCode;
  if (databaseId) {
    const createdAt = readText(readValue(record, "createdAt", "createAt", "registeredDate", "registeredAt"));
    const createdYear = createdAt ? new Date(createdAt).getFullYear() : Number.NaN;
    const year = Number.isInteger(createdYear) ? createdYear : new Date().getFullYear();
    return `SVC-${year}-${databaseId.padStart(4, "0")}`;
  }
  return "Service reference unavailable";
};

const mapService = (item: ApiRecord): ServiceRecord | null => {
  const databaseId = readDatabaseId(item);
  const trackingNumber = readText(readValue(item, "trackingNumber", "serviceNumber", "serviceCode", "code"));
  const id = databaseId || trackingNumber;
  if (!id) return null;
  const serviceCode = normalizeServiceCode(item, databaseId);

  const importer = readValue(item, "importer", "importerProfile", "importerDetails", "importer_detail");
  const customer = readValue(item, "customer", "customerProfile", "importer");
  const importerFirstName = readNestedText(importer, "firstName");
  const importerLastName = readNestedText(importer, "lastName");
  const importerName =
    readText(readValue(item, "importerName", "importer_name", "businessName", "companyName")) ||
    readNestedText(customer, "name", "businessName", "companyName", "importerName") ||
    readNestedText(importer, "name", "businessName", "fullName") ||
    [importerFirstName, importerLastName].filter(Boolean).join(" ") ||
    readNestedText(importer, "username") ||
    "";
  const assignedStaff = readValue(item, "assignedStaff", "assigned_staff");
  const executor = readValue(item, "assignedCaseExecutor", "assignedExecutor", "caseExecutor", "executor")
    ?? (assignedStaff && typeof assignedStaff === "object" && !Array.isArray(assignedStaff)
      ? readValue(assignedStaff as ApiRecord, "executor")
      : undefined);
  const referenceNumber = readText(
    readValue(item, "referenceNumber", "reference_number", "serviceReference", "clientReference", "externalReference"),
  );
  const createdAt = readValue(item, "createAt", "createdAt", "registeredDate", "registeredAt");
  const updatedAt = readValue(item, "updatedAt", "lastUpdateDate") ?? createdAt;
  const consignment = readValue(item, "consignment", "consignmentDetails", "consignment_detail");
  const eta = readValue(item, "eta", "estimatedArrival", "estimated_arrival", "expectedArrival", "arrivalDate") ??
    readValue(
      consignment && typeof consignment === "object" && !Array.isArray(consignment)
        ? consignment as ApiRecord
        : {},
      "eta",
      "estimatedArrival",
      "estimated_arrival",
      "expectedArrival",
      "arrivalDate",
    );
  const dueAt = readValue(item, "dueAt", "slaDueAt", "slaDeadline", "sla_deadline", "deadline", "targetDate");
  const status = normalizeRegisterStatus(item);
  const sla = getSla(
    dueAt,
    readValue(item, "sla", "slaPosition"),
    status,
    readValue(item, "isOverdue", "overdue"),
  );
  const executorFirstName = readNestedText(executor, "firstName");
  const executorLastName = readNestedText(executor, "lastName");
  const executorName =
    readNestedText(executor, "name") ||
    [executorFirstName, executorLastName].filter(Boolean).join(" ");
  const commodity = readText(readValue(item, "commodity", "goodsDescription", "cargoDescription", "cargo_description"));

  return {
    id,
    ...(databaseId ? { shipmentId: databaseId } : {}),
    ...(referenceNumber ? { referenceNumber } : {}),
    title:
      [
        readValue(item, "description", "cargoDescription", "cargo_description"),
        readValue(item, "title"),
        commodity,
      ]
        .map(readText)
        .find(Boolean) || "Cargo description unavailable",
    ...(commodity ? { commodity } : {}),
    importerName,
    importerCode:
      readText(readValue(item, "importerCode", "importer_code", "customerCode", "customer_code")) ||
      readNestedText(customer, "customerCode", "customer_code", "importerCode") ||
      readNestedText(importer, "customerCode", "customer_code", "importerCode") ||
      "",
    mode: normalizeMode(
      readValue(item, "mode", "transportMode") ?? readValue(item, "serviceType", "type"),
    ),
    status,
    riskChannel: normalizeRisk(readValue(
      item,
      "risk_channel",
      "riskChannel",
      "riskChannelName",
      "risk_channel_name",
      "customsChannel",
      "channelName",
      "riskLevel",
    )),
    caseExecutor: executorName || readNestedText(executor, "username") || "—",
    eta: formatDateOnly(eta),
    sla: sla.sla,
    ...(readText(dueAt) ? { slaDeadline: readText(dueAt) } : {}),
    serviceCode,
    slaDaysRemaining: sla.daysRemaining,
    ...(sla.isOverdue ? { isOverdue: true } : {}),
    updated: formatUpdatedDate(updatedAt),
    updatedAtTimestamp: toTimestamp(updatedAt),
  };
};

const mapManagerService = (item: ManagerExecutorAssignment): ServiceRecord | null => {
  const mode = normalizeMode(item.mode);
  const serviceType = normalizeMode(item.serviceType);

  return mapService({
    id: item.id,
    trackingNumber: item.code || item.trackingNumber || "",
    serviceCode: item.code,
    code: item.code,
    referenceNumber: item.reference_number,
    description: item.cargo_description || item.description,
    cargoDescription: item.cargo_description,
    routeSummary: item.route_summary,
    origin: item.origin,
    destination: item.destination,
    transitPort: item.transitPort,
    importer: item.importer,
    importerName: item.importerName,
    importerId: item.importerId,
    customerCode: item.importer?.customer_code,
    mode: mode !== "Unknown" ? mode : serviceType,
    status: item.status,
    riskChannel: item.risk_channel,
    riskLevel: item.risk_channel ?? item.riskLevel,
    assignedCaseExecutor: item.assigned_staff?.executor ?? item.assignedCaseExecutor,
    assignedStaff: item.assigned_staff,
    createAt: item.createAt,
    updatedAt: item.updatedAt,
    dueAt: item.dueAt,
    slaDeadline: item.slaDeadline,
    sla: item.sla,
    slaPosition: item.slaPosition,
    isOverdue: item.isOverdue,
    eta: item.eta,
    estimatedArrival: item.estimated_arrival,
    completedAt: item.completedAt,
    deliveredAt: item.deliveredAt,
    currentStageStartedAt: item.currentStageStartedAt,
    isBlocked: item.isBlocked,
    requiresCustomerAction: item.requiresCustomerAction,
  });
};

const unwrapApiData = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as ApiRecord;
  for (const key of ["data", "payload", "response", "result"]) {
    const nested = readValue(record, key);
    if (nested !== undefined && nested !== value) return unwrapApiData(nested);
  }
  return value;
};

export const useServiceStore = create<ServiceStore>((set, get) => ({
  services: [],
  visibleColumns: allColumns,
  loading: false,
  error: null,
  searchQuery: "",
  statusFilter: "ALL",
  modeFilter: "ALL",
  channelFilter: "ALL",

  fetchServices: async () => {
    set({ loading: true, error: null });
    try {
      const response = await AssessorEndpoints.getServicesUnderOversight();
      const services = normalizeRecordList(unwrapApiData(response))
        .map(mapService)
        .filter((service): service is ServiceRecord => service !== null);
      set({
        services,
        loading: false,
        error: null,
      });
    } catch (error: unknown) {
      set({
        loading: false,
        error: typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Failed to load assessor services.",
      });
    }
  },

  fetchManagerServices: async (params) => {
    set({ loading: true, error: null });

    const managerStore = useManagerStore.getState();
    const records = await managerStore.fetchServices(params);
    const error = useManagerStore.getState().error;

    if (error) {
      set({ services: [], loading: false, error });
      return;
    }

    set({
      services: records
        .map(mapManagerService)
        .filter((service): service is ServiceRecord => service !== null),
      loading: false,
      error: null,
    });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  setModeFilter: (mode) => set({ modeFilter: mode }),
  setChannelFilter: (channel) => set({ channelFilter: channel }),
  toggleColumn: (column) => set((state) => {
    const visibleColumns = state.visibleColumns.includes(column)
      ? state.visibleColumns.filter((visible) => visible !== column)
      : [...state.visibleColumns, column];
    return { visibleColumns: visibleColumns.length ? visibleColumns : state.visibleColumns };
  }),

  getFilteredServices: () => {
    const { services, searchQuery, statusFilter, modeFilter, channelFilter } = get();
    const query = searchQuery.trim().toLowerCase();

    return services.filter((item) =>
      (!query ||
        [
          item.id,
          item.shipmentId ?? "",
          item.referenceNumber ?? "",
          item.title,
          item.commodity ?? "",
          item.importerName,
          item.importerCode,
          item.caseExecutor,
        ]
          .some((value) => value.toLowerCase().includes(query))) &&
      (statusFilter === "ALL" || item.status === statusFilter) &&
      (modeFilter === "ALL" || item.mode === modeFilter) &&
      (channelFilter === "ALL" || item.riskChannel === channelFilter),
    );
  },
}));
