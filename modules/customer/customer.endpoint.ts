import { service } from "@/modules/utils/axios/service";
import { API_ROUTES } from "@/modules/api";
import { getAccountProfile } from "@/modules/auth/auth.endpoint";
import type {
  CustomerCreateServicePayload,
  CustomerInspectionTypePayload,
  CustomerRegisterPayload,
  CustomerUpdateProfilePayload,
} from "./customer.type";

export const customerEndpoints = {
  registerCustomer: (payload: CustomerRegisterPayload, accessToken?: string) =>
    service.post(
      API_ROUTES.customer.register,
      { ...payload, role: "Customer" },
      accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
    ),
  getProfile: () => service.get(API_ROUTES.customer.getProfile),
  getAccountProfile,
  updateProfile: (payload: CustomerUpdateProfilePayload) =>
    service.put(API_ROUTES.customer.updateProfile, payload),
  getNotifications: () => service.get(API_ROUTES.customer.getNotifications),
  markNotificationAsRead: (notificationId: string | number) =>
    service.put(API_ROUTES.customer.markNotificationAsRead, { notificationId }),
  createService: (payload: CustomerCreateServicePayload) =>
    service.post(API_ROUTES.customer.createService, payload),
  getMyServices: () => service.get(API_ROUTES.customer.getMyServices),
  updateInspectionType: (payload: CustomerInspectionTypePayload) =>
    service.put(API_ROUTES.customer.updateInspectionType, payload),
  uploadStageDocument: (payload: FormData) =>
    service.post(API_ROUTES.customer.uploadStageDocument, payload),
  uploadKycDocument: (payload: FormData) =>
    fetch("/api/customer/kyc-documents", {
      method: "POST",
      credentials: "include",
      body: payload,
    }),
};

export const registerCustomer = (
  payload: CustomerRegisterPayload,
  accessToken?: string,
) => customerEndpoints.registerCustomer(payload, accessToken);

export const getCustomerProfile = () => customerEndpoints.getProfile();

export const getCustomerAccountProfile = () =>
  customerEndpoints.getAccountProfile();

export const updateCustomerProfile = (payload: CustomerUpdateProfilePayload) =>
  customerEndpoints.updateProfile(payload);

export const getCustomerNotifications = () => customerEndpoints.getNotifications();

export const markCustomerNotificationAsRead = (notificationId: string | number) =>
  customerEndpoints.markNotificationAsRead(notificationId);

export const createCustomerService = (payload: CustomerCreateServicePayload) =>
  customerEndpoints.createService(payload);

export const getMyCustomerServices = () => customerEndpoints.getMyServices();

export const updateCustomerInspectionType = (payload: CustomerInspectionTypePayload) =>
  customerEndpoints.updateInspectionType(payload);

export const uploadCustomerStageDocument = (payload: FormData) =>
  customerEndpoints.uploadStageDocument(payload);

export const uploadCustomerKycDocument = (payload: FormData) =>
  customerEndpoints.uploadKycDocument(payload);
