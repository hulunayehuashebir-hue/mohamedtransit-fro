import { create } from "zustand";
import { ManagerEndpoints } from "./manager.endpoint";
import { MANAGER_WORKFLOW_STAGE_NAMES } from "./manager.type";
import type { NotificationCategory, NotificationItem } from "@/features/notifications/notification.types";
import type {
  ManagerAssignedUserSummary,
  ManagerAssignedStaffMember,
  ManagerAddStageDiscussionRequest,
  ManagerConsignmentDetails,
  ManagerCustomer,
  ManagerCustomerDocumentSummary,
  ManagerCustomerPagination,
  ManagerCustomerQuery,
  ManagerDashboardSummary,
  ManagerEscalateServiceRequest,
  ManagerExecutorAssignment,
  ManagerExecutorAssignmentRequest,
  ManagerNotifyImporterRequest,
  ManagerReportsAnalytics,
  ManagerServiceActivity,
  ManagerStageDiscussion,
  ManagerServiceDocument,
  ManagerServiceDetail,
  ManagerServiceMessage,
  ManagerServiceStage,
  ManagerImporterDetail,
  ManagerWorkflowStageStatus,
  ManagerServicePagination,
  ManagerServiceQuery,
  ManagerStaff,
} from "./manager.type";
import type { ShipmentServiceStageUpdatePayload } from "@/modules/shipment/shipment.types";

interface ManagerState {
  dashboardData: ManagerDashboardSummary | null;
  reportsAnalytics: ManagerReportsAnalytics | null;
  reportsLoading: boolean;
  reportsError: string | null;
  serviceDetailLoading: boolean;
  serviceDetailError: string | null;
  serviceDocumentsError: string | null;
  serviceActivities: ManagerServiceActivity[];
  serviceActivitiesError: string | null;
  consignmentDetails: ManagerConsignmentDetails | null;
  consignmentLoading: boolean;
  consignmentError: string | null;
  stageDiscussions: ManagerStageDiscussion[];
  stageDiscussionsLoading: boolean;
  stageDiscussionsError: string | null;
  notifications: NotificationItem[];
  notificationsLoading: boolean;
  notificationsError: string | null;
  services: ManagerExecutorAssignment[];
  servicePagination: ManagerServicePagination;
  customers: ManagerCustomer[];
  customersLoading: boolean;
  customersError: string | null;
  staff: ManagerStaff[];
  staffLoading: boolean;
  staffError: string | null;
  customerPagination: ManagerCustomerPagination;
  selectedService: ManagerServiceDetail | null;
  lastExecutorAssignment: ManagerExecutorAssignment | null;
  loading: boolean;
  error: string | null;
  fetchDashboard: () => Promise<void>;
  fetchReportsAnalytics: () => Promise<void>;
  fetchNotifications: () => Promise<NotificationItem[]>;
  fetchServices: (params?: ManagerServiceQuery) => Promise<ManagerExecutorAssignment[]>;
  fetchStaff: () => Promise<ManagerStaff[]>;
  fetchCustomers: (params?: ManagerCustomerQuery) => Promise<ManagerCustomer[]>;
  fetchServiceById: (id: string | number) => Promise<ManagerServiceDetail | null>;
  updateServiceStage: (
    payload: ShipmentServiceStageUpdatePayload,
  ) => Promise<{
    success: boolean;
    error?: string;
  }>;
  uploadServiceDocument: (payload: FormData) => Promise<void>;
  assignExecutor: (payload: ManagerExecutorAssignmentRequest) => Promise<boolean>;
  fetchStageDiscussions: (stageId: number, serviceId: number) => Promise<ManagerStageDiscussion[]>;
  addStageDiscussion: (payload: ManagerAddStageDiscussionRequest) => Promise<void>;
  notifyImporter: (payload: ManagerNotifyImporterRequest) => Promise<void>;
  escalateService: (payload: ManagerEscalateServiceRequest) => Promise<void>;
  fetchConsignmentDetails: (serviceId: number) => Promise<ManagerConsignmentDetails | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readField = (record: Record<string, unknown>, ...names: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    names.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const normalizeForeignKey = (value: unknown): number | string | undefined => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (!normalized) return undefined;
  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized);
    return Number.isSafeInteger(numericValue) && numericValue > 0
      ? numericValue
      : undefined;
  }
  return normalized;
};

const isMissingUnassignedUserError = (error: unknown): boolean => {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (/user.*(?:id\s*)?['"]?0['"]?.*not found/i.test(value)) return true;
      continue;
    }
    if (value instanceof Error) {
      pending.push(value.message);
      continue;
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isRecord(value) || seen.has(value)) continue;
    seen.add(value);
    pending.push(value.message, value.detail, value.title, value.errors, value.response, value.data);
  }

  return false;
};

const isMissingManagerServiceError = (error: unknown): boolean => {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (
        /\b404\b.*not found/i.test(value) ||
        /service.*not found|not found.*service/i.test(value)
      ) {
        return true;
      }
      continue;
    }
    if (value instanceof Error) {
      pending.push(value.message);
      continue;
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isRecord(value) || seen.has(value)) continue;
    seen.add(value);
    if (Number(value.status ?? value.statusCode) === 404) return true;
    pending.push(value.message, value.detail, value.title, value.errors, value.response, value.data);
  }

  return false;
};

const readServiceId = (record: Record<string, unknown>, ...keys: string[]): number | string | undefined => {
  for (const key of keys) {
    const value = readField(record, key);
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) continue;
      if (/^\d+$/.test(normalized) && (!Number.isSafeInteger(Number(normalized)) || Number(normalized) <= 0)) {
        continue;
      }
      return normalized;
    }
  }
  return undefined;
};

const normalizeAssignedUser = (value: unknown): ManagerAssignedUserSummary | null => {
  if (!isRecord(value)) return null;

  const rawId = readField(value, "id", "userId", "staffId");
  const id = normalizeForeignKey(rawId);
  if (rawId !== undefined && rawId !== null && id === undefined) return null;
  const readText = (...keys: string[]) => {
    const field = readField(value, ...keys);
    return typeof field === "string" ? field : null;
  };

  return {
    id: typeof id === "number" || typeof id === "string" ? id : undefined,
    name: readText("name", "displayName", "fullName"),
    username: readText("username", "userName"),
    email: readText("email"),
    firstName: readText("firstName", "givenName"),
    lastName: readText("lastName", "surname"),
    businessName: readText("businessName", "companyName", "importerName"),
    profilePhoto: readText("profilePhoto", "profileImage"),
    phone: readText("phone", "phoneNumber", "contactPhone"),
    role: readText("role", "roleName", "jobTitle"),
    is_active: readField(value, "isActive", "is_active", "active") === true
      || readField(value, "isActive", "is_active", "active") === 1
      || readField(value, "isActive", "is_active", "active") === "true"
      || readField(value, "isActive", "is_active", "active") === "1",
    customer_code: readText("customerCode", "customer_code", "importerCode"),
    tin: readText("tin", "tinNumber", "taxIdentificationNumber"),
    contact_person: readText("contactPerson", "contact_person"),
  };
};

const normalizeImporterDetail = (
  value: unknown,
  fallbackId?: number | string,
): ManagerImporterDetail | null => {
  const importer = normalizeAssignedUser(value);
  const id = importer?.id ?? fallbackId;
  if (!importer || id === undefined || id === null || String(id) === "0") return null;

  return {
    ...importer,
    id,
    name: importer.name || importer.businessName
      || [importer.firstName, importer.lastName].filter(Boolean).join(" ")
      || importer.username
      || "—",
    customer_code: importer.customer_code || null,
    tin: importer.tin || null,
    contact_person: importer.contact_person || null,
    phone: importer.phone || null,
  };
};

const normalizeStaff = (value: unknown): ManagerStaff | null => {
  if (!isRecord(value)) return null;

  const id = ["userId", "staffId", "id"]
    .map((field) => readField(value, field))
    .find((candidate) => {
      if (typeof candidate !== "number" && typeof candidate !== "string") return false;
      const normalized = String(candidate).trim();
      return /^[1-9]\d*$/.test(normalized) && Number.isSafeInteger(Number(normalized));
    });
  if (typeof id !== "number" && typeof id !== "string") return null;
  const numericId = Number(id);
  const roleRecords = Array.isArray(value.roles)
    ? value.roles
    : Array.isArray(value.userRoles)
      ? value.userRoles
      : [];
  const rawRoleIds = Array.isArray(value.roleIds)
    ? value.roleIds
    : Array.isArray(value.RoleIds)
      ? value.RoleIds
      : [];
  const rawRoleNames = Array.isArray(value.roleNames)
    ? value.roleNames
    : Array.isArray(value.RoleNames)
      ? value.RoleNames
      : [];
  const roleIdValues = rawRoleIds.flatMap((roleId) => {
    const parsedId = typeof roleId === "number"
      ? roleId
      : typeof roleId === "string" && /^\d+$/.test(roleId.trim())
        ? Number(roleId)
        : NaN;
    return Number.isSafeInteger(parsedId) && parsedId > 0 ? [parsedId] : [];
  });
  const roleNameValues = rawRoleNames.flatMap((roleName) =>
    typeof roleName === "string" && roleName.trim() ? [roleName.trim()] : [],
  );
  const assignedRoles = roleRecords.flatMap((assignment) => {
    if (!isRecord(assignment)) return [];
    const nestedRole = isRecord(assignment.role) ? assignment.role : null;
    const rawId = assignment.roleId
      ?? nestedRole?.id
      ?? (typeof (assignment.roleName ?? assignment.name) === "string" ? assignment.id : undefined);
    const rawName = assignment.roleName ?? assignment.name ?? assignment.displayName
      ?? nestedRole?.roleName ?? nestedRole?.name;
    const roleId = typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && /^\d+$/.test(rawId)
        ? Number(rawId)
        : undefined;
    if (
      roleId === undefined ||
      !Number.isSafeInteger(roleId) ||
      roleId <= 0 ||
      typeof rawName !== "string" ||
      !rawName.trim()
    ) {
      return [];
    }
    return [{ id: roleId, roleName: rawName.trim() }];
  });
  const parallelAssignedRoles = roleIdValues.flatMap((roleId, index) => {
    const roleName = roleNameValues[index];
    return roleName ? [{ id: roleId, roleName }] : [];
  });
  const roleIds = [
    ...roleIdValues,
    ...roleRecords.flatMap((role) => {
      if (!isRecord(role)) return [];
      const nestedRole = isRecord(role.role) ? role.role : null;
      const roleId = role.roleId ?? nestedRole?.id ?? (typeof role.roleName === "string" ? role.id : undefined);
      return typeof roleId === "number" ? [roleId] : [];
    }),
  ];
  const roleNames = [
    ...(typeof value.role === "string" && value.role.trim() ? [value.role.trim()] : []),
    ...(typeof value.roleName === "string" && value.roleName.trim() ? [value.roleName.trim()] : []),
    ...roleNameValues,
    ...roleRecords.flatMap((role) => {
      if (typeof role === "string") return [role];
      if (!isRecord(role)) return [];
      const nestedRole = isRecord(role.role) ? role.role : null;
      const roleName = role.roleName ?? nestedRole?.roleName ?? nestedRole?.name;
      return typeof roleName === "string" && roleName.trim() ? [roleName.trim()] : [];
    }),
  ];
  const branch = value.branchName ?? value.branch ?? value.branchOffice ?? value.assignedBranch;
  const branchName = typeof branch === "string"
    ? branch
    : isRecord(branch)
      ? (typeof branch.name === "string" ? branch.name : typeof branch.branchName === "string" ? branch.branchName : null)
      : null;
  const openCasesValue = value.openCases ?? value.openCaseCount ?? value.assignedOpenCases;
  const parsedOpenCases = Number(openCasesValue);
  const availabilityValue = value.availability ?? value.availabilityStatus;
  const availability = typeof availabilityValue === "string"
    ? availabilityValue
    : typeof value.isAvailable === "boolean"
      ? value.isAvailable ? "Available" : "Offline"
      : typeof value.isOnline === "boolean"
        ? value.isOnline ? "Online" : "Offline"
        : null;
  const lockedValue = readField(value, "isAccountLocked", "isLocked", "locked");
  const isAccountLocked = lockedValue === true || lockedValue === 1 || lockedValue === "true" || lockedValue === "1";

  return {
    id: numericId,
    name: typeof value.name === "string" ? value.name : null,
    username: typeof value.username === "string" ? value.username : null,
    email: typeof value.email === "string" ? value.email : null,
    firstName: typeof value.firstName === "string" ? value.firstName : null,
    lastName: typeof value.lastName === "string" ? value.lastName : null,
    profilePhoto: typeof value.profilePhoto === "string" ? value.profilePhoto : null,
    phone: typeof value.phone === "string" ? value.phone : null,
    isActive: (() => {
      const explicit = readField(value, "isActive", "active", "is_active");
      if (explicit === true || explicit === 1 || explicit === "true") return true;
      if (explicit === false || explicit === 0 || explicit === "false") return false;
      const status = readField(value, "accountStatus", "status");
      return typeof status === "string" && status.trim().toLowerCase() === "active";
    })() && !isAccountLocked,
    isAccountLocked,
    accountStatus: typeof value.accountStatus === "number" || typeof value.accountStatus === "string"
      ? value.accountStatus
      : null,
    roleIds: [...new Set(roleIds)],
    roleNames: [...new Set(roleNames)],
    assignedRoles: [...new Map(
      [...assignedRoles, ...parallelAssignedRoles].map((role) => [role.id, role]),
    ).values()],
    branchName,
    openCases: openCasesValue !== undefined && Number.isFinite(parsedOpenCases) ? parsedOpenCases : null,
    availability,
  };
};

const normalizeRiskChannel = (value: unknown): "blue" | "green" | "yellow" | "red" | null => {
  if (isRecord(value)) {
    return normalizeRiskChannel(readField(value, "name", "label", "riskChannel", "riskLevel", "value", "code", "id"));
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized.includes("blue")) return "blue";
    if (normalized.includes("green")) return "green";
    if (normalized.includes("yellow")) return "yellow";
    if (normalized.includes("red")) return "red";
    if (/^[1-4]$/.test(normalized)) {
      return ({ "1": "blue", "2": "green", "3": "yellow", "4": "red" } as const)[normalized as "1" | "2" | "3" | "4"];
    }
  }
  if (typeof value === "number") {
    return ({ 1: "blue", 2: "green", 3: "yellow", 4: "red" } as const)[value as 1 | 2 | 3 | 4] ?? null;
  }
  return null;
};

const normalizeAssignedStaffMember = (
  user: ManagerAssignedUserSummary | null,
  defaultRole: string,
): ManagerAssignedStaffMember | null => {
  if (!user || user.id === undefined || user.id === null || String(user.id) === "0") return null;
  return {
    id: user.id,
    name: user.name || user.businessName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.email || "",
    role: user.role || defaultRole,
    is_active: user.is_active === true,
  };
};

const notificationCategories: NotificationCategory[] = [
  "Service Updates",
  "Documents",
  "Approvals",
  "Payments",
  "Inspection",
  "Risk",
  "Messages",
  "System",
];

const normalizeManagerNotification = (value: unknown, index: number): NotificationItem | null => {
  if (!isRecord(value)) return null;

  const id = value.id ?? value.Id ?? value.notificationId ?? value.NotificationId;
  const category = value.category ?? value.Category ?? value.type ?? value.Type;
  const priorityValue = value.priority ?? value.Priority;
  const urgent = value.isUrgent === true || value.IsUrgent === true || value.isUrgent === 1 || value.IsUrgent === 1;
  const priority = priorityValue === "CRITICAL" || priorityValue === "HIGH"
    ? priorityValue
    : urgent
      ? "HIGH"
      : undefined;
  const categoryByType: Record<number, NotificationCategory> = {
    1: "Service Updates",
    2: "Documents",
    3: "Service Updates",
    4: "Payments",
    5: "System",
    6: "Messages",
  };
  const normalizedCategory = typeof category === "string" && notificationCategories.includes(category as NotificationCategory)
    ? category as NotificationCategory
    : typeof category === "number"
      ? categoryByType[category]
      : typeof category === "string" && /^\d+$/.test(category)
        ? categoryByType[Number(category)]
        : undefined;

  return {
    id: String(id ?? index),
    title: typeof (value.title ?? value.Title) === "string" ? String(value.title ?? value.Title) : "Notification",
    description: typeof (value.description ?? value.Description ?? value.message ?? value.Message) === "string"
      ? String(value.description ?? value.Description ?? value.message ?? value.Message)
      : "",
    category: normalizedCategory ?? "System",
    time: typeof (value.time ?? value.createdDate ?? value.CreatedDate ?? value.createAt) === "string"
      ? String(value.time ?? value.createdDate ?? value.CreatedDate ?? value.createAt)
      : "Just now",
    referenceId: String(value.referenceId ?? value.ReferenceId ?? value.serviceId ?? value.ServiceId ?? ""),
    isRead: value.isRead === true || value.IsRead === true || value.isRead === 1 || value.IsRead === 1
      || value.isRead === "true" || value.IsRead === "true" || value.isRead === "1" || value.IsRead === "1",
    isNew: value.isNew === true || value.IsNew === true || value.isNew === 1 || value.IsNew === 1
      || value.isNew === "true" || value.IsNew === "true" || value.isNew === "1" || value.IsNew === "1",
    priority,
  };
};

const normalizeAssignment = (value: unknown): ManagerExecutorAssignment | null => {
  if (!isRecord(value)) return null;

  const trackingNumberValue = readField(
    value,
    "trackingNumber",
    "serviceNumber",
    "serviceReference",
    "serviceCode",
    "code",
    "referenceNumber",
    "reference_number",
  );
  const id = readServiceId(
    value,
    "id",
    "shipmentId",
    "serviceId",
    "databaseId",
    "shipmentDatabaseId",
    "serviceDatabaseId",
    "recordId",
    "serviceCode",
  );
  const importerIdValue = readField(value, "importerId", "customerId");
  const trackingNumber = typeof trackingNumberValue === "string" ? trackingNumberValue : "";
  const importerId = normalizeForeignKey(importerIdValue);
  const readText = (...keys: string[]) => {
    const field = readField(value, ...keys);
    return typeof field === "string" ? field : "";
  };
  const readId = (...keys: string[]) => {
    return normalizeForeignKey(readField(value, ...keys)) ?? null;
  };
  const readScalar = (...keys: string[]) => {
    const field = readField(value, ...keys);
    return typeof field === "number" || typeof field === "string" ? field : null;
  };
  const readBoolean = (...keys: string[]): boolean | undefined => {
    const field = readField(value, ...keys);
    if (typeof field === "boolean") return field;
    if (field === 1 || field === "1" || (typeof field === "string" && field.toLowerCase() === "true")) return true;
    if (field === 0 || field === "0" || (typeof field === "string" && field.toLowerCase() === "false")) return false;
    return undefined;
  };
  const importerRecord = readField(value, "importer", "customer", "importerProfile");
  const assignedCaseExecutor = normalizeAssignedUser(readField(value, "assignedCaseExecutor", "caseExecutor", "executor"));
  const assignedAssessor = normalizeAssignedUser(readField(value, "assignedAssessor", "assessor"));
  const importer = normalizeAssignedUser(importerRecord);
  const code = readText("code", "serviceCode");
  const referenceNumber = readText("referenceNumber", "reference_number", "referenceNo");

  if (!trackingNumber || id === undefined) return null;

  return {
    id,
    trackingNumber,
    code: code || (/^SVC-/i.test(trackingNumber) ? trackingNumber : null),
    reference_number: referenceNumber || (trackingNumber.includes("/") ? trackingNumber : null),
    cargo_description: readText("cargoDescription", "cargo_description", "description", "itemDescription", "title") || null,
    route_summary: readText("routeSummary", "route_summary") || null,
    estimated_arrival: readText("estimatedArrival", "estimated_arrival", "eta") || null,
    risk_channel: normalizeRiskChannel(readField(value, "riskChannel", "risk_channel", "riskLevel")),
    risk_channel_label: readText("riskChannelLabel", "risk_channel_label") || null,
    risk_channel_description: readText("riskChannelDescription", "risk_channel_description") || null,
    isBlocked: readBoolean("isBlocked", "blocked"),
    requiresCustomerAction: readBoolean("requiresCustomerAction", "requires_customer_action", "customerActionRequired"),
    importerId,
    importer: importer
      ? {
          ...importer,
          id: importer.id ?? importerId,
          name: importer.name || importer.businessName || [importer.firstName, importer.lastName].filter(Boolean).join(" ") || importer.username || "",
          customer_code: importer.customer_code || null,
          tin: importer.tin || null,
          contact_person: importer.contact_person || null,
          phone: importer.phone || null,
        }
      : null,
    description: readText("description", "itemDescription", "title"),
    importerName: readText("importerName", "businessName") || null,
    mode: readScalar("mode", "transportMode"),
    status: readScalar("status", "serviceStatus") ?? "",
    assignedHub: readId("assignedHub", "assignedHubId"),
    assignedCaseExecutorId: readId("assignedCaseExecutorId", "caseExecutorId", "assignedTo", "assigneeId"),
    assignedCaseExecutor,
    assignedAssessorId: readId("assignedAssessorId", "assessorId"),
    assignedAssessor,
    assigned_staff: {
      executor: normalizeAssignedStaffMember(assignedCaseExecutor, "Case Executor"),
      assessor: normalizeAssignedStaffMember(assignedAssessor, "Assessor"),
    },
    createdByUser: normalizeAssignedUser(readField(value, "createdByUser", "createdBy")),
    customerId: readId("customerId", "importerId"),
    assignmentNotes: readText("assignmentNotes", "notes") || null,
    origin: readText("origin", "countryOfOrigin"),
    destination: readText("destination"),
    routeCategory: readText("routeCategory", "destination") || null,
    eta: readText("eta", "estimatedArrival") || null,
    dueAt: readText("dueAt", "dueDate", "slaDueAt", "slaDeadline") || null,
    lastUpdateDate: readText("lastUpdateDate", "updatedAt", "lastUpdatedAt") || null,
    registeredDate: readText("registeredDate", "createAt", "createdAt") || null,
    completedAt: readText("completedAt", "completionDate") || null,
    deliveredAt: readText("deliveredAt", "deliveryDate") || null,
    transitPort: readText("transitPort", "transit_port", "transitLocation") || null,
    currentStageStartedAt: readText("currentStageStartedAt", "stageStartedAt", "stageEnteredAt") || null,
    declaredValue: readScalar("declaredValue"),
    taxCategory: readText("taxCategory") || null,
    countryOfOrigin: readText("countryOfOrigin") || null,
    serviceType: readScalar("serviceType", "serviceMode"),
    riskLevel: readScalar("riskLevel", "riskChannel"),
    createAt: readText("createAt", "createdAt", "registeredDate"),
    updatedAt: readText("updatedAt", "lastUpdateDate") || null,
    recordStatus: Number(readField(value, "recordStatus")) || 0,
  };
};

const normalizeServiceMessage = (value: unknown): ManagerServiceMessage | null => {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "number" || typeof value.id === "string" ? value.id : undefined;
  const serviceId = typeof value.serviceId === "number" || typeof value.serviceId === "string" ? value.serviceId : undefined;
  const senderUserId = typeof value.senderUserId === "number" || typeof value.senderUserId === "string" ? value.senderUserId : undefined;

  if (id === undefined || serviceId === undefined || senderUserId === undefined) return null;

  return {
    id,
    subject: typeof value.subject === "string" ? value.subject : "",
    content: typeof value.content === "string" ? value.content : "",
    messageType: typeof value.messageType === "number" ? value.messageType : 0,
    isRead: value.isRead === true,
    readAt: typeof value.readAt === "string" ? value.readAt : null,
    isUrgent: value.isUrgent === true,
    priority: typeof value.priority === "number" || typeof value.priority === "string" ? value.priority : null,
    createdDate: typeof value.createdDate === "string" ? value.createdDate : "",
    serviceId,
    senderUserId,
    recipientUserId: typeof value.recipientUserId === "number" || typeof value.recipientUserId === "string" ? value.recipientUserId : null,
    serviceStageId: typeof value.serviceStageId === "number" || typeof value.serviceStageId === "string" ? value.serviceStageId : null,
    senderUser: normalizeAssignedUser(value.senderUser),
    recipientUser: normalizeAssignedUser(value.recipientUser),
    createAt: typeof value.createAt === "string" ? value.createAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    recordStatus: typeof value.recordStatus === "number" ? value.recordStatus : 0,
  };
};

const normalizeStageDiscussion = (value: unknown, index: number): ManagerStageDiscussion | null => {
  if (!isRecord(value)) return null;

  const authorValue = readField(value, "user", "author", "createdBy", "sender");
  const authorRecord = isRecord(authorValue) ? authorValue : null;
  const author = authorRecord
    ? [
        readField(authorRecord, "firstName"),
        readField(authorRecord, "lastName"),
      ]
        .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
        .join(" ") || readField(authorRecord, "username", "name", "email")
    : authorValue;
  const createdAt = readField(value, "createdAt", "createAt", "createdDate", "timestamp");
  const comment = readField(value, "comment", "message", "content", "text");
  const id = readField(value, "id", "discussionId", "commentId");

  return {
    id: id === null || id === undefined ? `discussion-${index}` : String(id),
    comment: typeof comment === "string" ? comment : "",
    createdAt: typeof createdAt === "string" ? createdAt : null,
    author: typeof author === "string" && author.trim() ? author : null,
  };
};

const normalizeServiceActivity = (value: unknown, index: number): ManagerServiceActivity | null => {
  if (!isRecord(value)) return null;
  const rawId = readField(value, "id", "activityId", "serviceActivityId");
  const rawLabel = readField(value, "description", "title", "message", "activity", "action", "name");
  const rawDate = readField(value, "createdAt", "createAt", "occurredAt", "timestamp", "time");
  const label = typeof rawLabel === "string" ? rawLabel : "";
  if (!label.trim()) return null;
  return {
    id: rawId === null || rawId === undefined ? `activity-${index}` : String(rawId),
    label,
    date: typeof rawDate === "string" ? rawDate : null,
  };
};

const normalizeConsignmentDetails = (value: unknown): ManagerConsignmentDetails | null => {
  if (!isRecord(value)) return null;
  const readText = (...keys: string[]) => {
    const field = readField(value, ...keys);
    return typeof field === "string" ? field : null;
  };
  const declaredValue = readField(value, "declaredValue", "cargoValue", "value");
  return {
    description: readText("description", "itemDescription", "goodsDescription"),
    origin: readText("origin", "countryOfOrigin", "originCountry"),
    destination: readText("destination", "destinationCountry"),
    declaredValue: typeof declaredValue === "number" || typeof declaredValue === "string"
      ? declaredValue
      : null,
    taxCategory: readText("taxCategory", "taxType"),
    countryOfOrigin: readText("countryOfOrigin", "originCountry"),
    registeredDate: readText("registeredDate", "createdAt", "createAt"),
  };
};

const normalizeServiceCollection = (value: unknown, collectionNames: string[]): unknown[] => {
  let current = value;
  const collectionKeys = collectionNames.map((name) => name.toLowerCase());
  const wrapperKeys = ["data", "payload", "response", "result", "resultdata", "items", "records", "rows"];

  for (let depth = 0; depth < 8; depth += 1) {
    if (Array.isArray(current)) return current;
    if (!isRecord(current)) return [];

    const collection = Object.entries(current).find(
      ([key, entry]) => collectionKeys.includes(key.toLowerCase()) && (Array.isArray(entry) || isRecord(entry)),
    );
    if (collection) {
      current = collection[1];
      continue;
    }

    const wrapper = Object.entries(current).find(
      ([key, entry]) => wrapperKeys.includes(key.toLowerCase()) && (Array.isArray(entry) || isRecord(entry)),
    );
    if (wrapper) {
      current = wrapper[1];
      continue;
    }

    return [];
  }

  return [];
};

const normalizeWorkflowStageStatus = (value: unknown): ManagerWorkflowStageStatus | undefined => {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const numericStatus = Number(value);
    if (numericStatus === 4) return "completed";
    if (numericStatus === 3) return "in_progress";
    if (numericStatus === 1 || numericStatus === 2) return "not_started";
    if (numericStatus === 5 || numericStatus === 6) return "needs_review";
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, "");
  if (normalized.includes("complete") || normalized.includes("deliver")) return "completed";
  if (normalized.includes("progress") || normalized.includes("active")) return "in_progress";
  if (normalized.includes("review") || normalized.includes("block")) return "needs_review";
  if (normalized.includes("notstarted") || normalized.includes("pending") || normalized.includes("draft")) {
    return "not_started";
  }
  return undefined;
};

const normalizeServiceStage = (value: unknown, index = 0): ManagerServiceStage | null => {
  if (!isRecord(value)) return null;

  const nullableText = (...keys: string[]): string | null => {
    const field = readField(value, ...keys);
    return typeof field === "string" || typeof field === "number" ? String(field) : null;
  };
  const positiveId = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const field = readField(value, key);
      const normalized = typeof field === "number"
        ? String(field)
        : typeof field === "string"
          ? field.trim()
          : "";
      if (!normalized || !/^[1-9]\d*$/.test(normalized)) continue;
      const id = Number(normalized);
      if (Number.isSafeInteger(id)) return id;
    }
    return undefined;
  };
  const nullableStatus = (...keys: string[]): number | string | null => {
    const field = readField(value, ...keys);
    return typeof field === "number" || typeof field === "string" ? field : null;
  };

  const rawOrder = readField(value, "order", "stageOrder", "sequence", "step");
  const orderFromName = nullableText("stageName", "name", "title", "stage")?.match(/^(?:stage\s*)?(\d+)$/i)?.[1];
  const parsedOrder = Number(rawOrder ?? orderFromName);
  const order = Number.isSafeInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : index + 1;
  const rawStatus = nullableStatus("status") ?? nullableStatus("stageStatus") ?? nullableStatus("currentStatus");
  const rawName = nullableText("stageName", "name", "title", "stage");
  const canonicalName = MANAGER_WORKFLOW_STAGE_NAMES[order - 1];
  const name = !rawName || /^\s*(?:stage\s*)?\d+\s*$/i.test(rawName)
    ? canonicalName ?? rawName ?? `Stage ${order}`
    : rawName;
  const stageExecutionId = positiveId(
    "stageExecutionId",
    "serviceStageExecutionId",
    "executionId",
    "shipmentStageId",
    "id",
  );
  const serviceStageId = positiveId(
    "serviceStageId",
    "stageId",
    "workflowStageId",
    "stageDefinitionId",
    "stageTemplateId",
  );

  return {
    ...value,
    id: stageExecutionId,
    order,
    serviceStageId,
    stageExecutionId,
    serviceStageExecutionId: stageExecutionId,
    executionId: stageExecutionId,
    stageName: name,
    name,
    status: normalizeWorkflowStageStatus(rawStatus) ?? null,
    apiStatus: rawStatus,
    stageStatus: nullableStatus("stageStatus"),
    currentStatus: nullableStatus("currentStatus"),
    createdAt: nullableText("createdAt", "createAt"),
    updatedAt: nullableText("updatedAt", "lastUpdatedAt"),
    updated_at: nullableText("updatedAt", "lastUpdatedAt"),
    completedAt: nullableText("completedAt", "finishedAt"),
    notes: nullableText("notes", "stageNotes", "summary"),
    comments: nullableText("comments", "comment"),
    documents: normalizeServiceCollection(value, [
      "documents",
      "stageDocuments",
      "serviceDocuments",
      "serviceStageDocuments",
      "shipmentDocuments",
    ])
      .map(normalizeServiceDocument)
      .filter((document): document is ManagerServiceDocument => document !== null),
  };
};

const normalizeServiceDocument = (value: unknown): ManagerServiceDocument | null => {
  if (!isRecord(value)) return null;

  const nullableText = (...keys: string[]): string | null => {
    const field = readField(value, ...keys);
    return typeof field === "string" || typeof field === "number" ? String(field) : null;
  };
  const nullableId = (...keys: string[]): number | string | undefined => {
    const field = readField(value, ...keys);
    return typeof field === "number" || typeof field === "string" ? field : undefined;
  };
  const isTrue = (...keys: string[]): boolean => {
    const field = readField(value, ...keys);
    return field === true || field === 1 || field === "1" || field === "true";
  };
  const stageId = nullableId("stageId", "serviceStageId", "shipmentStageId");
  const documentStatus = readField(value, "status", "documentStatus", "uploadStatus");

  return {
    id: nullableId("id", "documentId"),
    fileName: nullableText("fileName"),
    originalFileName: nullableText("originalFileName", "originalName"),
    status: typeof documentStatus === "number" || typeof documentStatus === "string" ? documentStatus : null,
    fileExtension: nullableText("fileExtension"),
    mimeType: nullableText("mimeType", "contentType"),
    documentType: typeof readField(value, "documentType", "type") === "number" || typeof readField(value, "documentType", "type") === "string"
      ? readField(value, "documentType", "type") as number | string
      : null,
    description: nullableText("description"),
    isRequired: isTrue("isRequired", "required"),
    isVerified: isTrue("isVerified", "verified"),
    verificationNotes: nullableText("verificationNotes"),
    fileSizeBytes: typeof readField(value, "fileSizeBytes", "sizeBytes") === "number"
      ? readField(value, "fileSizeBytes", "sizeBytes") as number
      : null,
    stageId: stageId ?? null,
    createAt: nullableText("createAt", "createdAt", "uploadedAt"),
  };
};

const normalizeServiceDetail = (value: unknown): ManagerServiceDetail | null => {
  if (!isRecord(value)) return null;

  const service = normalizeAssignment(value);
  if (!service) return null;
  const importerDetail = normalizeImporterDetail(
    readField(value, "importer", "customer", "importerProfile"),
    service.importerId,
  );

  return {
    ...service,
    importer: importerDetail,
    stages: normalizeServiceCollection(value, ["stages", "serviceStages", "shipmentStages", "executions", "serviceStageExecutions"])
      .map((stage, index) => normalizeServiceStage(stage, index))
      .filter((stage): stage is ManagerServiceStage => stage !== null),
    documents: normalizeServiceCollection(value, [
      "documents",
      "stageDocuments",
      "serviceDocuments",
      "serviceStageDocuments",
      "shipmentDocuments",
    ])
      .map(normalizeServiceDocument)
      .filter((document): document is ManagerServiceDocument => document !== null),
    messages: normalizeServiceCollection(value, ["messages", "serviceMessages", "stageDiscussions"])
      .map(normalizeServiceMessage)
      .filter((message): message is ManagerServiceMessage => message !== null),
  };
};

const unwrapPagedData = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  if ("response" in value && value.response !== undefined) {
    return unwrapPagedData(value.response);
  }

  if ("payload" in value && value.payload !== undefined) {
    return unwrapPagedData(value.payload);
  }

  if ("data" in value && value.data !== undefined) {
    return Array.isArray(value.data) ? value : unwrapPagedData(value.data);
  }

  return value;
};

const normalizeCustomerDocument = (value: unknown): ManagerCustomerDocumentSummary | null => {
  if (!isRecord(value)) return null;

  return {
    id: typeof value.id === "number" || typeof value.id === "string" ? value.id : undefined,
    fileName: typeof value.fileName === "string" ? value.fileName : null,
    documentName: typeof value.documentName === "string" ? value.documentName : null,
    documentType: typeof value.documentType === "string" ? value.documentType : null,
    status: typeof value.status === "number" || typeof value.status === "string" ? value.status : null,
    uploadedAt: typeof value.uploadedAt === "string" ? value.uploadedAt : null,
  };
};

const normalizeCustomer = (value: unknown): ManagerCustomer | null => {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "number" || typeof value.id === "string" ? value.id : undefined;
  if (id === undefined) return null;

  const nullableText = (key: string): string | null =>
    typeof value[key] === "string" ? value[key] as string : null;
  const nullableId = (key: string): number | string | null =>
    typeof value[key] === "number" || typeof value[key] === "string" ? value[key] as number | string : null;

  return {
    id,
    businessName: nullableText("businessName"),
    tinNumber: nullableText("tinNumber"),
    businessLicense: nullableText("businessLicense"),
    businessAddress: nullableText("businessAddress"),
    startDate: nullableText("startDate"),
    city: nullableText("city"),
    state: nullableText("state"),
    postalCode: nullableText("postalCode"),
    contactPerson: nullableText("contactPerson"),
    contactPhone: nullableText("contactPhone"),
    contactEmail: nullableText("contactEmail"),
    businessType: nullableText("businessType"),
    importLicense: nullableText("importLicense"),
    importLicenseExpiry: nullableText("importLicenseExpiry"),
    isVerified: value.isVerified === true,
    verifiedAt: nullableText("verifiedAt"),
    verifiedByUserId: nullableId("verifiedByUserId"),
    verificationNotes: nullableText("verificationNotes"),
    userId: nullableId("userId"),
    createdByDataEncoderId: nullableId("createdByDataEncoderId"),
    user: normalizeAssignedUser(value.user),
    createdByDataEncoder: normalizeAssignedUser(value.createdByDataEncoder),
    verifiedByUser: normalizeAssignedUser(value.verifiedByUser),
    documents: Array.isArray(value.documents)
      ? value.documents.map(normalizeCustomerDocument).filter((document): document is ManagerCustomerDocumentSummary => document !== null)
      : [],
    createAt: nullableText("createAt"),
    updatedAt: nullableText("updatedAt"),
    recordStatus: typeof value.recordStatus === "number" ? value.recordStatus : undefined,
  };
};

const normalizeCustomerPage = (value: unknown): {
  customers: ManagerCustomer[];
  pagination: ManagerCustomerPagination;
} => {
  const pageData = unwrapPagedData(value);
  const pageRecord = isRecord(pageData) ? pageData : {};
  const rows = Array.isArray(pageData)
    ? pageData
    : Array.isArray(pageRecord.data)
      ? pageRecord.data
      : [];
  const customers = rows
    .map(normalizeCustomer)
    .filter((customer): customer is ManagerCustomer => customer !== null);
  const totalCount = normalizeNumber(pageRecord.totalCount ?? customers.length);
  const page = Math.max(1, normalizeNumber(pageRecord.page ?? 1));
  const pageSize = Math.max(1, normalizeNumber(pageRecord.pageSize ?? (customers.length || 20)));

  return {
    customers,
    pagination: {
      totalCount,
      page,
      pageSize,
      totalPages: normalizeNumber(pageRecord.totalPages ?? Math.ceil(totalCount / pageSize)),
    },
  };
};

const normalizeServicePage = (value: unknown): {
  services: ManagerExecutorAssignment[];
  pagination: ManagerServicePagination;
} => {
  const pageData = unwrapPagedData(value);
  const pageRecord = isRecord(pageData) ? pageData : {};
  const rows = Array.isArray(pageData)
    ? pageData
    : Array.isArray(pageRecord.data)
      ? pageRecord.data
      : [];
  const services = rows
    .map(normalizeAssignment)
    .filter((service): service is ManagerExecutorAssignment => service !== null);
  const totalCount = normalizeNumber(pageRecord.totalCount ?? services.length);
  const page = Math.max(1, normalizeNumber(pageRecord.page ?? 1));
  const pageSize = Math.max(1, normalizeNumber(pageRecord.pageSize ?? (services.length || 20)));

  return {
    services,
    pagination: {
      totalCount,
      page,
      pageSize,
      totalPages: normalizeNumber(pageRecord.totalPages ?? Math.ceil(totalCount / pageSize)),
    },
  };
};

const unwrapApiData = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  if ("data" in record && record.data !== undefined) {
    return unwrapApiData(record.data);
  }

  if ("payload" in record && record.payload !== undefined) {
    return unwrapApiData(record.payload);
  }

  if ("response" in record && record.response !== undefined) {
    return unwrapApiData(record.response);
  }

  return record;
};

const EMPTY_MANAGER_SUMMARY: ManagerDashboardSummary = {
  totalServices: 0,
  pendingServices: 0,
  inProgressServices: 0,
  completedServices: 0,
  openCases: 0,
  needsAttention: 0,
  dueWithin48Hours: null,
  clearedThisMonth: 0,
  totalCustomers: 0,
  verifiedCustomers: 0,
  totalStaff: 0,
  activeStaff: 0,
  recentServices: [],
  monthlyServiceStats: [],
};

const normalizeNumber = (value: unknown): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeManagerDashboardSummary = (value: unknown): ManagerDashboardSummary => {
  if (!isRecord(value)) {
    return EMPTY_MANAGER_SUMMARY;
  }

  const normalized: ManagerDashboardSummary = {
    totalServices: normalizeNumber(value.totalServices),
    pendingServices: normalizeNumber(value.pendingServices),
    inProgressServices: normalizeNumber(value.inProgressServices),
    completedServices: normalizeNumber(value.completedServices),
    openCases: value.openCases === undefined ? undefined : normalizeNumber(value.openCases),
    needsAttention: value.needsAttention === undefined ? undefined : normalizeNumber(value.needsAttention),
    dueWithin48Hours: value.dueWithin48Hours === null || value.dueWithin48Hours === undefined
      ? null
      : normalizeNumber(value.dueWithin48Hours),
    clearedThisMonth: value.clearedThisMonth === undefined ? undefined : normalizeNumber(value.clearedThisMonth),
    totalCustomers: normalizeNumber(value.totalCustomers),
    verifiedCustomers: normalizeNumber(value.verifiedCustomers),
    totalStaff: normalizeNumber(value.totalStaff),
    activeStaff: normalizeNumber(value.activeStaff),
    recentServices: Array.isArray(value.recentServices) ? (value.recentServices as ManagerDashboardSummary["recentServices"]) : [],
    monthlyServiceStats: Array.isArray(value.monthlyServiceStats)
      ? (value.monthlyServiceStats as ManagerDashboardSummary["monthlyServiceStats"])
      : [],
  };

  return normalized;
};

const normalizeManagerReportsAnalytics = (value: unknown): ManagerReportsAnalytics => {
  if (!isRecord(value)) {
    throw new Error("The manager reports endpoint returned an invalid response.");
  }

  const readNumber = (input: unknown, field: string): number => {
    const numeric = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(numeric)) {
      throw new Error(`The manager reports endpoint returned an invalid ${field}.`);
    }
    return numeric;
  };
  const readRows = (key: string): Record<string, unknown>[] => {
    const rows = value[key];
    if (!Array.isArray(rows)) {
      throw new Error(`The manager reports endpoint did not include ${key}.`);
    }
    return rows.map((row) => {
      if (!isRecord(row)) {
        throw new Error(`The manager reports endpoint returned an invalid ${key} row.`);
      }
      return row;
    });
  };
  const readNullableNumber = (field: string): number | null =>
    value[field] === null || value[field] === undefined
      ? null
      : readNumber(value[field], field);

  return {
    openCases: readNumber(value.openCases, "open cases"),
    completedYearToDate: readNumber(value.completedYearToDate, "year-to-date completions"),
    onTimeClearanceRate: readNullableNumber("onTimeClearanceRate"),
    averageStageDurationHours: readNullableNumber("averageStageDurationHours"),
    monthlyThroughput: readRows("monthlyThroughput").map((row) => ({
      year: readNumber(row.year, "month year"),
      month: readNumber(row.month, "month"),
      multimodal: readNumber(row.multimodal, "multimodal throughput"),
      unimodal: readNumber(row.unimodal, "unimodal throughput"),
      completed: readNumber(row.completed, "completed throughput"),
    })),
    riskChannels: readRows("riskChannels").map((row) => {
      if (typeof row.channel !== "string") {
        throw new Error("The manager reports endpoint returned an invalid risk channel.");
      }
      return { channel: row.channel, count: readNumber(row.count, "risk channel count") };
    }),
    stageDurations: readRows("stageDurations").map((row) => {
      if (typeof row.stage !== "string") {
        throw new Error("The manager reports endpoint returned an invalid stage name.");
      }
      return { stage: row.stage, averageHours: readNumber(row.averageHours, "stage duration") };
    }),
    executorPerformance: readRows("executorPerformance").map((row) => {
      if (typeof row.executorName !== "string") {
        throw new Error("The manager reports endpoint returned an invalid executor name.");
      }
      const rawOnTimeRate = row.onTimeRate ?? row.onTimePercentage ?? row.onTimeClearanceRate;
      const onTimeCount = row.onTimeCases ?? row.casesCompletedOnTime;
      const casesClosed = readNumber(row.casesClosed, "closed cases");
      const onTimeRate = rawOnTimeRate === null || rawOnTimeRate === undefined
        ? onTimeCount === null || onTimeCount === undefined || casesClosed <= 0
          ? null
          : (readNumber(onTimeCount, "on-time cases") / casesClosed) * 100
        : readNumber(rawOnTimeRate, "executor on-time rate");
      return {
        executorId: readNumber(row.executorId, "executor id"),
        executorName: row.executorName,
        casesClosed,
        onTimeRate: onTimeRate === null ? null : onTimeRate <= 1 ? onTimeRate * 100 : onTimeRate,
        averageCycleDays: row.averageCycleDays === null || row.averageCycleDays === undefined
          ? null
          : readNumber(row.averageCycleDays, "average cycle duration"),
        openLoad: readNumber(row.openLoad, "open workload"),
      };
    }),
  };
};

export const useManagerStore = create<ManagerState>((set, get) => ({
  dashboardData: null,
  reportsAnalytics: null,
  reportsLoading: false,
  reportsError: null,
  serviceDetailLoading: false,
  serviceDetailError: null,
  serviceDocumentsError: null,
  serviceActivities: [],
  serviceActivitiesError: null,
  consignmentDetails: null,
  consignmentLoading: false,
  consignmentError: null,
  stageDiscussions: [],
  stageDiscussionsLoading: false,
  stageDiscussionsError: null,
  notifications: [],
  notificationsLoading: false,
  notificationsError: null,
  services: [],
  servicePagination: { totalCount: 0, page: 1, pageSize: 20, totalPages: 0 },
  customers: [],
  customersLoading: false,
  customersError: null,
  staff: [],
  staffLoading: false,
  staffError: null,
  customerPagination: { totalCount: 0, page: 1, pageSize: 20, totalPages: 0 },
  selectedService: null,
  lastExecutorAssignment: null,
  loading: false,
  error: null,

  fetchNotifications: async () => {
    set({ notificationsLoading: true, notificationsError: null });

    try {
      const response = await ManagerEndpoints.getNotifications();
      const payload = unwrapApiData(response);
      const notificationRows = normalizeServiceCollection(payload, ["notifications", "items", "records"]);
      const rows = notificationRows.length
        ? notificationRows
        : isRecord(payload) && readField(payload, "id", "notificationId") !== undefined
          ? [payload]
          : [];
      const notifications = rows
        .map(normalizeManagerNotification)
        .filter((notification): notification is NotificationItem => notification !== null);
      set({ notifications, notificationsLoading: false, notificationsError: null });
      return notifications;
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load notifications.";
      set({ notifications: [], notificationsLoading: false, notificationsError: message });
      return [];
    }
  },

  fetchServices: async (params) => {
    set({ loading: true, error: null });

    try {
      const response = await ManagerEndpoints.getAllServices(params);
      const result = normalizeServicePage(response);
      set({ services: result.services, servicePagination: result.pagination, loading: false, error: null });
      return result.services;
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load services.";
      set({
        services: [],
        servicePagination: { totalCount: 0, page: 1, pageSize: 20, totalPages: 0 },
        loading: false,
        error: message,
      });
      return [];
    }
  },

  fetchStaff: async () => {
    set({ staffLoading: true, staffError: null });

    try {
      const response = await ManagerEndpoints.getAllStaff();
      const payload = unwrapApiData(response);
      const staff = Array.isArray(payload)
        ? payload.map(normalizeStaff).filter((member): member is ManagerStaff => member !== null)
        : [];
      set({ staff, staffLoading: false, staffError: null });
      return staff;
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load staff.";
      set({ staff: [], staffLoading: false, staffError: message });
      return [];
    }
  },

  fetchCustomers: async (params) => {
    set({ customersLoading: true, customersError: null });

    try {
      const response = await ManagerEndpoints.getAllCustomers(params);
      const result = normalizeCustomerPage(response);
      set({
        customers: result.customers,
        customerPagination: result.pagination,
        customersLoading: false,
        customersError: null,
      });
      return result.customers;
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load customers.";
      set({
        customers: [],
        customerPagination: { totalCount: 0, page: 1, pageSize: 20, totalPages: 0 },
        customersLoading: false,
        customersError: message,
      });
      return [];
    }
  },

  fetchServiceById: async (id) => {
    set({
      selectedService: null,
      serviceDetailLoading: true,
      serviceDetailError: null,
      serviceDocumentsError: null,
      serviceActivities: [],
      serviceActivitiesError: null,
      consignmentDetails: null,
      consignmentLoading: false,
      consignmentError: null,
      stageDiscussions: [],
      stageDiscussionsLoading: false,
      stageDiscussionsError: null,
    });

    try {
      const requestedId = String(id).trim();
      let serviceId: number;
      if (/^[1-9]\d*$/.test(requestedId) && Number.isSafeInteger(Number(requestedId))) {
        serviceId = Number(requestedId);
      } else {
        const normalizedCode = requestedId.toLowerCase();
        const findByCode = (services: ManagerExecutorAssignment[]) =>
          services.find((candidate) =>
            [candidate.code, candidate.reference_number, candidate.trackingNumber]
              .some((serviceCode) => serviceCode?.trim().toLowerCase() === normalizedCode) &&
            /^[1-9]\d*$/.test(String(candidate.id)) &&
            Number.isSafeInteger(Number(candidate.id)),
          );
        let matchingService = findByCode(get().services);

        if (!matchingService) {
          let page = 1;
          let totalPages = 1;
          const pageSize = 20;
          while (page <= totalPages) {
            const response = await ManagerEndpoints.getAllServices({ page, pageSize });
            const servicePage = normalizeServicePage(response);
            matchingService = findByCode(servicePage.services);
            totalPages = Math.max(totalPages, servicePage.pagination.totalPages);
            if (matchingService) break;
            page += 1;
          }
        }

        const resolvedId = matchingService?.id;
        if (resolvedId === undefined || !/^[1-9]\d*$/.test(String(resolvedId))) {
          throw new Error(
            `Service "${requestedId}" was not found with a numeric database ID in the Manager service list.`,
          );
        }
        serviceId = Number(resolvedId);
        if (!Number.isSafeInteger(serviceId)) {
          throw new Error(`Service "${requestedId}" has an invalid numeric database ID.`);
        }
      }

      let serviceDetails: ManagerServiceDetail | null = null;
      try {
        const response = await ManagerEndpoints.getServiceById(serviceId);
        serviceDetails = normalizeServiceDetail(unwrapApiData(response));
      } catch (error: unknown) {
        if (!isMissingUnassignedUserError(error) && !isMissingManagerServiceError(error)) {
          throw error;
        }

        let fallbackService = get().services.find(
          (candidate) => Number(candidate.id) === serviceId,
        );
        try {
          let page = 1;
          let totalPages = 1;
          while (!fallbackService && page <= totalPages) {
            const fallbackResponse = await ManagerEndpoints.getAllServices({ page, pageSize: 20 });
            const servicePage = normalizeServicePage(fallbackResponse);
            fallbackService = servicePage.services.find(
              (candidate) => Number(candidate.id) === serviceId,
            );
            totalPages = Math.max(totalPages, servicePage.pagination.totalPages);
            page += 1;
          }
        } catch (fallbackError: unknown) {
          console.warn(
            `Unable to load the service-list fallback after Manager/GetServiceById returned an unassigned-user error for service ${serviceId}.`,
            fallbackError,
          );
        }

        if (fallbackService) {
          console.warn(
            `Manager/GetServiceById could not resolve service ${serviceId}; using the Manager service-list record.`,
          );
          serviceDetails = {
            ...fallbackService,
            importer: normalizeImporterDetail(fallbackService.importer, fallbackService.importerId),
            stages: [],
            documents: [],
            messages: [],
          };
        } else {
          if (!isMissingUnassignedUserError(error)) throw error;
          set({
            selectedService: null,
            serviceDetailLoading: false,
            serviceDetailError: null,
          });
          return null;
        }
      }

      if (!serviceDetails) {
        throw new Error("No service details returned from the API.");
      }

      const [stagesResponse, activitiesResponse] = await Promise.allSettled([
        ManagerEndpoints.getServiceStages(serviceId),
        ManagerEndpoints.getServiceActivities(serviceId),
      ]);
      const apiStages = stagesResponse.status === "fulfilled"
        ? normalizeServiceCollection(
            unwrapApiData(stagesResponse.value),
            ["stages", "serviceStages", "shipmentStages", "executions", "serviceStageExecutions"],
          )
            .map((stage, index) => normalizeServiceStage(stage, index))
            .filter((stage): stage is ManagerServiceStage => stage !== null)
        : [];
      const apiActivities = activitiesResponse.status === "fulfilled"
        ? normalizeServiceCollection(
            unwrapApiData(activitiesResponse.value),
            ["activities", "serviceActivities", "items", "records"],
          )
            .map(normalizeServiceActivity)
            .filter((activity): activity is ManagerServiceActivity => activity !== null)
        : [];
      const serviceActivitiesError = activitiesResponse.status === "rejected"
        ? typeof activitiesResponse.reason === "string"
          ? activitiesResponse.reason
          : activitiesResponse.reason instanceof Error
            ? activitiesResponse.reason.message
            : "Failed to load service activities."
        : null;

      const stagesForDocuments = apiStages.length ? apiStages : serviceDetails.stages;
      const documentResults: Array<{
        stageId: number | string | null;
        documents: ManagerServiceDocument[];
        error: string | null;
      }> = await Promise.all(
        stagesForDocuments.map(async (stage) => {
          const stageId = stage.stageExecutionId
            ?? stage.serviceStageExecutionId
            ?? stage.executionId
            ?? stage.id;
          if (stageId === undefined || !/^[1-9]\d*$/.test(String(stageId))) {
            return { stageId: null, documents: [], error: null };
          }

          try {
            const response = await ManagerEndpoints.getStageDocuments(serviceId, stageId);
            const documents = normalizeServiceCollection(unwrapApiData(response), [
              "documents",
              "stageDocuments",
              "serviceDocuments",
              "serviceStageDocuments",
              "shipmentDocuments",
            ])
              .flatMap((document): ManagerServiceDocument[] => {
                const normalized = normalizeServiceDocument(document);
                return normalized
                  ? [{ ...normalized, stageId: normalized.stageId ?? stageId }]
                  : [];
              });
            return { stageId, documents, error: null };
          } catch (error: unknown) {
            return {
              stageId,
              documents: [],
              error: typeof error === "string"
                ? error
                : error instanceof Error
                  ? error.message
                  : "Failed to load service documents.",
            };
          }
        }),
      );
      const apiDocuments = documentResults.flatMap((result) => result.documents);
      const serviceDocumentsError = documentResults.find((result) => result.error)?.error ?? null;

      const stages = stagesForDocuments
        .map((stage) => {
          const stageIds = [stage.id, stage.serviceStageId, stage.stageExecutionId, stage.serviceStageExecutionId, stage.executionId]
            .filter((stageId): stageId is number | string => stageId !== undefined);
          const detailStage = serviceDetails.stages.find((candidate) =>
            [candidate.id, candidate.serviceStageId, candidate.stageExecutionId, candidate.serviceStageExecutionId, candidate.executionId]
              .some((stageId) => stageId !== undefined && stageIds.some((candidateId) => String(candidateId) === String(stageId))),
          ) ?? serviceDetails.stages.find((candidate) => candidate.order === stage.order);
          const relatedDocuments = apiDocuments.filter((document) =>
            document.stageId !== null
            && document.stageId !== undefined
            && stageIds.some((stageId) => String(document.stageId) === String(stageId)),
          );
          const documentsById = new Map<string, ManagerServiceDocument>();
          [...(detailStage?.documents ?? []), ...stage.documents, ...relatedDocuments].forEach((document, index) => {
            const key = document.id === undefined || document.id === null
              ? `${document.fileName ?? document.originalFileName ?? "document"}-${index}`
              : String(document.id);
            documentsById.set(key, document);
          });
          return {
            ...detailStage,
            ...stage,
            id: stage.id ?? detailStage?.id,
            serviceStageId: stage.serviceStageId ?? detailStage?.serviceStageId,
            status: stage.status ?? detailStage?.status ?? null,
            apiStatus: stage.apiStatus ?? detailStage?.apiStatus,
            notes: stage.notes ?? detailStage?.notes ?? null,
            updated_at: stage.updated_at ?? detailStage?.updated_at ?? null,
            documents: [...documentsById.values()],
          };
        })
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
      const selectedService = {
        ...serviceDetails,
        stages,
        documents: apiDocuments.length ? apiDocuments : serviceDetails.documents,
      };

      set({
        selectedService,
        serviceDetailLoading: false,
        serviceDetailError: null,
        serviceDocumentsError,
        serviceActivities: apiActivities,
        serviceActivitiesError,
      });
      return selectedService;
    } catch (error: unknown) {
      if (isMissingUnassignedUserError(error)) {
        set({ selectedService: null, serviceDetailLoading: false, serviceDetailError: null });
        return null;
      }
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load service details.";
      set({ selectedService: null, serviceDetailLoading: false, serviceDetailError: message });
      return null;
    }
  },

  updateServiceStage: async (payload) => {
    set({ serviceDetailError: null });
    const readPositiveId = (value: string | number | null | undefined): number | null => {
      const normalized = typeof value === "number" ? String(value) : value?.trim();
      if (!normalized || !/^[1-9]\d*$/.test(normalized)) return null;
      const id = Number(normalized);
      return Number.isSafeInteger(id) ? id : null;
    };
    const shipmentId = readPositiveId(payload.shipmentId);
    const stageExecutionId = readPositiveId(payload.stageExecutionId ?? payload.shipmentStageId);
    if (shipmentId === null || stageExecutionId === null) {
      const message = "A valid positive service ID and stage ID are required to update a stage.";
      set({ serviceDetailError: message });
      return { success: false, error: message };
    }

    set({ serviceDetailLoading: true, serviceDetailError: null });

    const statusMap: Record<string, number> = {
      notstarted: 1,
      pending: 2,
      inprogress: 3,
      completed: 4,
      blocked: 5,
      needsreview: 6,
    };
    const normalizedStatusKey = typeof payload.status === "string"
      ? payload.status.trim().toLowerCase().replaceAll(/[\s_-]+/g, "")
      : "";
    const numericStatus = statusMap[normalizedStatusKey] ?? (typeof payload.status === "number" ? payload.status : 3);

    try {
      const stageUpdatePayload = {
        shipmentId,
        shipmentStageId: stageExecutionId,
        status: payload.status,
        stageStatus: numericStatus,
        notes: payload.notes || "",
        riskLevel: payload.riskLevel,
      };
      await ManagerEndpoints.updateServiceStage(stageUpdatePayload);
    } catch (error: unknown) {
      if (isMissingUnassignedUserError(error)) {
        const message = "Please assign a valid Case Executor to this service before updating the stage.";
        set({ serviceDetailLoading: false, serviceDetailError: message });
        return { success: false, error: message };
      }

      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to update service stage.";
      set({ serviceDetailLoading: false, serviceDetailError: message });
      return { success: false, error: message };
    }

    set({ serviceDetailLoading: false, serviceDetailError: null });
    try {
      await get().fetchServiceById(shipmentId);
    } catch (refreshError: unknown) {
      if (!isMissingUnassignedUserError(refreshError)) {
        console.warn("Stage update succeeded but refreshing details failed.", refreshError);
      }
    }
    return { success: true };
  },

  uploadServiceDocument: async (payload) => {
    await ManagerEndpoints.uploadServiceDocument(payload);
  },

  fetchStageDiscussions: async (stageId, serviceId) => {
    set({ stageDiscussions: [], stageDiscussionsLoading: true, stageDiscussionsError: null });
    try {
      const response = await ManagerEndpoints.getStageDiscussions(stageId, serviceId);
      const payload = unwrapApiData(response);
      const rows = normalizeServiceCollection(payload, ["discussions", "stageDiscussions", "comments", "messages"]);
      const discussionRows = rows.length || !isRecord(payload)
        ? rows
        : readField(payload, "id", "discussionId", "commentId") !== undefined
          ? [payload]
          : [];
      const discussions = discussionRows
        .map(normalizeStageDiscussion)
        .filter((discussion): discussion is ManagerStageDiscussion => discussion !== null);
      set({
        stageDiscussions: discussions,
        stageDiscussionsLoading: false,
        stageDiscussionsError: null,
      });
      return discussions;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load stage discussions.";
      set({ stageDiscussions: [], stageDiscussionsLoading: false, stageDiscussionsError: message });
      return [];
    }
  },

  addStageDiscussion: async (payload) => {
    try {
      await ManagerEndpoints.addStageDiscussion({
        ...payload,
        comment: payload.comment.trim(),
      });
      await get().fetchStageDiscussions(payload.stageId, payload.serviceId);
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : "Failed to add stage discussion.");
    }
  },

  notifyImporter: async (payload) => {
    try {
      await ManagerEndpoints.notifyImporter(payload);
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : "Failed to notify importer.");
    }
  },

  escalateService: async (payload) => {
    try {
      await ManagerEndpoints.escalateService(payload);
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : "Failed to escalate service.");
    }
  },

  fetchConsignmentDetails: async (serviceId) => {
    set({ consignmentDetails: null, consignmentLoading: true, consignmentError: null });
    try {
      const response = await ManagerEndpoints.getConsignmentDetails(serviceId);
      const details = normalizeConsignmentDetails(unwrapApiData(response));
      if (!details) {
        throw new Error("The Manager API returned invalid consignment details.");
      }
      set({ consignmentDetails: details, consignmentLoading: false, consignmentError: null });
      return details;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load consignment details.";
      set({ consignmentDetails: null, consignmentLoading: false, consignmentError: message });
      return null;
    }
  },

  assignExecutor: async (payload) => {
    set({ loading: true, error: null });

    try {
      await ManagerEndpoints.assignExecutor(payload);
      set({ loading: false, error: null });
      return true;
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to assign executor.";
      set({ loading: false, error: message });
      return false;
    }
  },

  fetchDashboard: async () => {
    set({ loading: true, error: null });

    try {
      const payload = unwrapApiData(await ManagerEndpoints.getDashboard());
      const nextDashboardData = normalizeManagerDashboardSummary(payload);

      set({
        dashboardData: nextDashboardData,
        loading: false,
        error: null,
      });
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load manager dashboard.";
      set({
        error: message,
        dashboardData: null,
        loading: false,
      });
    }
  },

  fetchReportsAnalytics: async () => {
    set({ reportsLoading: true, reportsError: null });

    try {
      const payload = unwrapApiData(await ManagerEndpoints.getReportsAnalytics());
      const reportsAnalytics = normalizeManagerReportsAnalytics(payload);
      set({ reportsAnalytics, reportsLoading: false, reportsError: null });
    } catch (error: unknown) {
      const message = typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to load manager reports.";
      set({ reportsAnalytics: null, reportsLoading: false, reportsError: message });
    }
  },
}));