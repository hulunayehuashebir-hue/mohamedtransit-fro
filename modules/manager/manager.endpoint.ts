import { service } from "@/modules/utils/axios/service";
import { API_ROUTES } from "@/modules/api";
import { shipmentEndpoints } from "@/modules/shipment/shipment.endpoint";
import type {
  ManagerAddStageDiscussionRequest,
  ManagerCustomerQuery,
  ManagerEscalateServiceRequest,
  ManagerExecutorAssignmentRequest,
  ManagerNotificationQuery,
  ManagerNotifyImporterRequest,
  ManagerServiceQuery,
} from "./manager.type";
import type {
  ShipmentDocumentPayload,
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
    const shipmentId = readPositiveIntegerId(payload.shipmentId, "shipment ID");
    const caseExecutorId = readPositiveIntegerId(payload.caseExecutorId, "case executor ID");
    return shipmentEndpoints.assign({
      shipmentId,
      caseExecutorId,
    });
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
  updateServiceStage: (payload: ShipmentServiceStageUpdatePayload) => {
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
    return service.put(API_ROUTES.shipment.updateServiceStage, {
      shipmentId,
      shipmentStageId: stageExecutionId,
      status,
      notes: typeof payload.notes === "string" ? payload.notes : null,
      ...(payload.riskLevel === undefined || payload.riskLevel === null
        ? {}
        : { riskLevel: payload.riskLevel }),
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
    return service.get(API_ROUTES.manager.getServiceById(serviceId));
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
    return service.get(API_ROUTES.manager.getStageDiscussions, {
      params: { serviceId: validServiceId, stageId: validStageId },
    });
  },
  addStageDiscussion: (payload: ManagerAddStageDiscussionRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const stageId = readPositiveIntegerId(payload.stageId, "stage ID");
    const comment = payload.comment.trim();
    if (!comment) {
      throw new Error("A discussion message is required.");
    }
    return service.post(API_ROUTES.manager.addStageDiscussion, {
      serviceId,
      stageId,
      comment,
    });
  },
  notifyImporter: (payload: ManagerNotifyImporterRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const subject = payload.subject?.trim() || "Service update";
    const message = payload.message.trim();
    if (!message) {
      throw new Error("A notification message is required.");
    }
    return service.post(API_ROUTES.manager.notifyImporter, {
      serviceId,
      subject,
      message,
      isUrgent: payload.isUrgent ?? false,
    });
  },
  escalateService: (payload: ManagerEscalateServiceRequest) => {
    const serviceId = readPositiveIntegerId(payload.serviceId, "service ID");
    const reason = payload.reason.trim();
    if (!reason) {
      throw new Error("An escalation reason is required.");
    }
    return service.post(API_ROUTES.manager.escalateService, {
      serviceId,
      reason,
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
  uploadServiceDocument: (payload: ShipmentDocumentPayload) =>
    shipmentEndpoints.uploadDocument(payload),
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
    service.get(API_ROUTES.manager.getAllStaff),
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
