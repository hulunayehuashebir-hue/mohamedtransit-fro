import { service } from "@/modules/utils/axios/service";
import { API_ROUTES } from "@/modules/api";
import { shipmentEndpoints } from "@/modules/shipment/shipment.endpoint";
import type {
  ManagerAddStageDiscussionRequest,
  ManagerAssessorAssignmentRequest,
  ManagerCustomerQuery,
  ManagerEscalateServiceRequest,
  ManagerExecutorAssignmentRequest,
  ManagerImporterMessageRequest,
  ManagerNotificationQuery,
  ManagerNotifyImporterRequest,
  ManagerServiceQuery,
  ManagerStageWorkspaceUpdateRequest,
} from "./manager.type";
import type {
  ShipmentParams,
  ShipmentPayload,
  ShipmentServiceStageUpdatePayload,
  StageTransportUpdatePayload,
} from "@/modules/shipment/shipment.types";

const stageStatusValues: Record<string, number> = {
  notstarted: 1,
  pending: 2,
  inprogress: 3,
  completed: 4,
  blocked: 5,
  needsreview: 6,
  requirescustomeraction: 7,
};

const readPositiveIntegerId = (value: string | number | null | undefined, fieldName: string): number => {
  const normalized = typeof value === "number" ? String(value) : value?.trim();
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`A valid ${fieldName} is required.`);
  }

  const id = Number(normalized);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`A valid ${fieldName} is required.`);
  }
  return id;
};

export const ManagerEndpoints = {
  getDashboard: () => service.get(API_ROUTES.manager.getDashboard),

  getReportsAnalytics: () => service.get(API_ROUTES.manager.getReportsAnalytics),
  createShipment: (payload: ShipmentPayload) => shipmentEndpoints.create(payload),
  assignExecutor: (payload: ManagerExecutorAssignmentRequest) => {
    const serviceId = readPositiveIntegerId(payload.shipmentId, "service ID");
    const caseExecutorId = readPositiveIntegerId(payload.caseExecutorId, "case executor ID");
    return service.post(API_ROUTES.manager.assignServiceExecutor(serviceId), {
      userId: caseExecutorId,
    });
  },
  assignAssessor: (payload: ManagerAssessorAssignmentRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const userId = readPositiveIntegerId(payload.userId, "assessor ID");
    return service.post(API_ROUTES.manager.assignServiceAssessor(serviceId), { userId });
  },
  updateShipment: (payload: ShipmentPayload) => shipmentEndpoints.update(payload),
  updateShipmentStatus: (
    id: string | number | undefined,
    payload?: ShipmentPayload | FormData,
  ) => shipmentEndpoints.updateStatus(id, payload),
  createStageTransport: (payload: ShipmentPayload) =>
    shipmentEndpoints.createStageTransport(payload),
  updateStageTransport: (payload: StageTransportUpdatePayload) =>
    shipmentEndpoints.updateStageTransport(payload),
  updateServiceStage: (payload: ManagerStageWorkspaceUpdateRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const stageId = readPositiveIntegerId(payload.stageId, "workflow stage ID");
    const acceptedStatuses = new Set([
      "notstarted",
      "inprogress",
      "needsreview",
      "requirescustomeraction",
      "completed",
      "blocked",
    ]);
    if (!acceptedStatuses.has(payload.stageStatus.toLowerCase().replaceAll(/[\s_-]+/g, ""))) {
      throw new Error("Select a valid workflow stage status before saving.");
    }
    if (!["draft", "advance", "block"].includes(payload.action)) {
      throw new Error("Select a valid workflow stage action before saving.");
    }

    return service.post(API_ROUTES.manager.updateServiceStage(serviceId, stageId), {
      action: payload.action,
      stageStatus: payload.stageStatus,
      riskChannel: payload.riskChannel,
      stageNote: payload.stageNote,
    });
  },
  updateStageStatus: (payload: ShipmentServiceStageUpdatePayload) => {
    const rawStatus = payload.status;
    const normalizedStatus = typeof rawStatus === "string"
      ? rawStatus.toLowerCase().replaceAll(/[\s_-]+/g, "")
      : "";
    const status = typeof rawStatus === "number"
      ? rawStatus
      : stageStatusValues[normalizedStatus];

    if (status === undefined || !Number.isInteger(status) || status < 1 || status > 6) {
      throw new Error("Select a valid workflow stage status before saving.");
    }

    const shipmentId = readPositiveIntegerId(payload.shipmentId, "service ID");
    const stageExecutionId = readPositiveIntegerId(
      payload.stageExecutionId ?? payload.shipmentStageId,
      "stage ID",
    );
    return service.put(API_ROUTES.shipment.updateStageStatus(), {
      shipmentId,
      shipmentStageId: stageExecutionId,
      status,
      notes: typeof payload.notes === "string" ? payload.notes : null,
      ...(payload.riskLevel === undefined || payload.riskLevel === null
        ? {}
        : { riskLevel: payload.riskLevel }),
    });
  },
  getServiceById: (id: string | number) => {
    const serviceId = readPositiveIntegerId(id, "service ID");
    return service.get(API_ROUTES.manager.serviceWorkspace(serviceId));
  },
  getStageDocuments: (serviceId: string | number, stageId: string | number) => {
    const validServiceId = readPositiveIntegerId(serviceId, "service ID");
    const validStageId = readPositiveIntegerId(stageId, "stage ID");
    return service.get(API_ROUTES.manager.getStageDocuments, {
      params: { serviceId: validServiceId, stageId: validStageId },
    });
  },
  getStageDiscussions: (stageId: number, serviceId: number) => {
    const validServiceId = readPositiveIntegerId(serviceId, "service ID");
    const validStageId = readPositiveIntegerId(stageId, "stage ID");
    return service.get(API_ROUTES.manager.serviceDiscussions(validServiceId, validStageId));
  },
  addStageDiscussion: (payload: ManagerAddStageDiscussionRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const stageId = readPositiveIntegerId(payload.stageId, "stage ID");
    const comment = payload.comment.trim();
    if (!comment) {
      throw new Error("A discussion message is required.");
    }
    return service.post(API_ROUTES.manager.serviceDiscussions(serviceId, stageId), {
      message: comment,
    });
  },
  notifyImporter: (payload: ManagerNotifyImporterRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const subject = payload.subject?.trim() || "Service update";
    const message = payload.message.trim();
    if (!message) {
      throw new Error("A notification message is required.");
    }
    return service.post(API_ROUTES.manager.workspaceNotifyImporter(serviceId), {
      subject,
      message,
    });
  },
  messageImporter: (payload: ManagerImporterMessageRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const subject = payload.subject?.trim() || "Service message";
    const message = payload.message.trim();
    if (!message) {
      throw new Error("A message to the importer is required.");
    }
    return service.post(API_ROUTES.manager.messageServiceImporter(serviceId), {
      subject,
      message,
    });
  },
  escalateService: (payload: ManagerEscalateServiceRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const reason = payload.reason.trim();
    if (!reason) {
      throw new Error("An escalation reason is required.");
    }
    return service.post(API_ROUTES.manager.workspaceEscalateService(serviceId), {
      reason,
      priority: "High",
    });
  },
  getServiceActivities: (id: string | number) => {
    const serviceId = readPositiveIntegerId(id, "service ID");
    return service.get(API_ROUTES.manager.getServiceActivities, { params: { serviceId } });
  },
  getConsignmentDetails: (id: string | number) => {
    const serviceId = readPositiveIntegerId(id, "service ID");
    return service.get(API_ROUTES.manager.getConsignmentDetails, { params: { serviceId } });
  },
  getServiceStages: (id: string | number) =>
    shipmentEndpoints.getStages({ shipmentId: readPositiveIntegerId(id, "service ID") }),
  getAllShipments: (params?: ShipmentParams) => shipmentEndpoints.getAll(params),
  getShipmentById: (id: string | number) => {
    const shipmentId = readPositiveIntegerId(id, "service ID");
    return shipmentEndpoints.getById(shipmentId);
  },
  getShipmentsByImporter: (importerId: string | number) => {
    const id = readPositiveIntegerId(importerId, "importer ID");
    return shipmentEndpoints.getByImporter(id);
  },
  deleteShipment: (id: string | number) => {
    const shipmentId = readPositiveIntegerId(id, "service ID");
    return shipmentEndpoints.delete(shipmentId);
  },
  getAllServices: (params?: ManagerServiceQuery) =>
    service.get(API_ROUTES.manager.getAllServices, { params }),
  getAllStaff: () =>
    service.get(API_ROUTES.manager.getAvailableStaff),
  uploadServiceDocument: (
    payload: FormData,
    onProgress?: (progress: number) => void,
  ) => {
    const serviceId = readPositiveIntegerId(
      String(payload.get("ServiceId") ?? payload.get("ShipmentId") ?? payload.get("serviceId") ?? ""),
      "service ID",
    );
    const stageId = readPositiveIntegerId(
      String(payload.get("WorkflowStageId") ?? payload.get("StageId") ?? payload.get("stageId") ?? ""),
      "workflow stage ID",
    );
    const file = payload.get("File") ?? payload.get("file");
    const documentType = payload.get("DocumentType") ?? payload.get("documentType");
    if (!(file instanceof File)) {
      throw new Error("Choose a file to upload.");
    }
    if (typeof documentType !== "string" || !documentType.trim()) {
      throw new Error("Select a document type before uploading.");
    }
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("documentType", documentType.trim());
    return service.post(
      API_ROUTES.manager.uploadStageDocument(serviceId, stageId),
      formData,
      {
        onUploadProgress: (event) => {
          if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
        },
      },
    );
  },
  downloadServiceDocument: (
    serviceId: string | number,
    stageId: string | number,
    documentId: string | number,
  ) => service.get(
    API_ROUTES.manager.downloadStageDocument(
      readPositiveIntegerId(serviceId, "service ID"),
      readPositiveIntegerId(stageId, "workflow stage ID"),
      readPositiveIntegerId(documentId, "document ID"),
    ),
    { responseType: "blob" },
  ),
  getStaffById: (id: string | number) =>
    service.get(API_ROUTES.auth.user.getById(id)),
  getNotifications: (params?: ManagerNotificationQuery) =>
    service.get(API_ROUTES.manager.getNotifications, { params }),
  getSupportRequests: () =>
    service.get(API_ROUTES.manager.getSupportRequests),
  getAllCustomers: (params: ManagerCustomerQuery = { page: 1, pageSize: 20 }) =>
    service.get(API_ROUTES.manager.getAllCustomers, {
      params: { ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 },
    }),
};
