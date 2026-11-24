"use client";

import { create } from "zustand";
import {
  createRole,
  createRolePrivileges,
  deleteRole,
  getAllRolePrivileges,
  getAllRoles,
  getRoleById,
  updateRole,
} from "./roles.endpoint";
import type {
  CreateRolePrivilegeRequest,
  RoleDto,
  RolePrivilegeDto,
} from "./roles.types";

interface RolesState {
  roles: RoleDto[];
  rolePrivileges: RolePrivilegeDto[];
  selectedRole: RoleDto | null;
  loading: boolean;
  error: string | null;
  fetchRoles: () => Promise<void>;
  fetchRoleById: (id: string | number) => Promise<RoleDto | null>;
  fetchRolePrivileges: () => Promise<RolePrivilegeDto[]>;
  assignRolePrivileges: (payload: CreateRolePrivilegeRequest) => Promise<unknown>;
  addRole: (payload: RoleDto) => Promise<void>;
  editRole: (payload: RoleDto) => Promise<void>;
  removeRole: (id: string | number) => Promise<void>;
  clearError: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (value: Record<string, unknown>, ...names: string[]): unknown => {
  const key = Object.keys(value).find((candidate) =>
    names.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key === undefined ? undefined : value[key];
};

const toRole = (value: unknown): RoleDto | null => {
  if (!isRecord(value)) return null;

  const roleName = readField(value, "roleName", "name", "displayName");
  if (typeof roleName !== "string" || !roleName.trim()) return null;

  const rawId = readField(value, "id", "roleId");
  const id = typeof rawId === "number"
    ? rawId
    : typeof rawId === "string" && /^\d+$/.test(rawId.trim())
      ? Number(rawId)
      : undefined;
  if (id === undefined || !Number.isSafeInteger(id) || id <= 0) return null;

  const rawPrivileges = readField(value, "privileges");

  return {
    ...value,
    id,
    roleName: roleName.trim(),
    privileges: Array.isArray(rawPrivileges) ? rawPrivileges : [],
  };
};

const extractRoles = (value: unknown, depth = 0): RoleDto[] => {
  if (depth > 8) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const role = toRole(item);
      return role ? [role] : extractRoles(item, depth + 1);
    });
  }

  if (!isRecord(value)) {
    return [];
  }

  const role = toRole(value);
  if (role) return [role];

  const nestedKeys = [
    "data",
    "payload",
    "response",
    "items",
    "roles",
    "roleList",
    "roleDtos",
    "records",
    "result",
    "$values",
  ];
  const nestedValues: unknown[] = nestedKeys.flatMap((key) => {
    const nested = readField(value, key);
    return nested === undefined || nested === value ? [] : [nested];
  });
  const knownKeys = new Set(nestedKeys.map((key) => key.toLowerCase()));
  nestedValues.push(
    ...Object.entries(value)
      .filter(([key, nested]) =>
        !knownKeys.has(key.toLowerCase()) &&
        (Array.isArray(nested) || isRecord(nested)),
      )
      .map(([, nested]) => nested),
  );

  for (const nested of nestedValues) {
    const nestedRoles = extractRoles(nested, depth + 1);
    if (nestedRoles.length > 0) return nestedRoles;
  }

  return [];
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : fallback;

const normalizeRolePrivilege = (value: unknown): RolePrivilegeDto | null => {
  if (!isRecord(value)) return null;

  const privilege = isRecord(value.privilege) ? value.privilege : null;
  const role = isRecord(value.role) ? value.role : null;

  return {
    id: typeof value.id === "number" ? value.id : Number(value.privilegeId ?? 0),
    roleId: typeof value.roleId === "number" ? value.roleId : Number(role?.id ?? 0),
    privilegeId: typeof value.privilegeId === "number" ? value.privilegeId : Number(value.id ?? 0),
    privilege: privilege
      ? {
          id: typeof privilege.id === "number" ? privilege.id : undefined,
          privilegeName: typeof privilege.privilegeName === "string" ? privilege.privilegeName : typeof privilege.name === "string" ? privilege.name : undefined,
          name: typeof privilege.name === "string" ? privilege.name : typeof privilege.privilegeName === "string" ? privilege.privilegeName : undefined,
        }
      : null,
    role: isRecord(value.role) ? ({
      id: typeof value.role.id === "number" ? value.role.id : undefined,
      roleName: typeof value.role.roleName === "string" ? value.role.roleName : "",
      privileges: Array.isArray(value.role.privileges) ? value.role.privileges as RoleDto["privileges"] : [],
    } as RoleDto) : null,
    recordStatus: typeof value.recordStatus === "number" ? value.recordStatus : 1,
  };
};

const extractRolePrivileges = (value: unknown): RolePrivilegeDto[] => {
  if (Array.isArray(value)) {
    return value.map(normalizeRolePrivilege).filter((item): item is RolePrivilegeDto => item !== null);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["data", "payload", "items", "result", "rolePrivileges"]) {
    const nested = value[key];
    const privileges = extractRolePrivileges(nested);
    if (privileges.length) {
      return privileges;
    }
  }

  const privilege = normalizeRolePrivilege(value);
  return privilege ? [privilege] : [];
};

export const useRolesStore = create<RolesState>((set) => ({
  roles: [],
  rolePrivileges: [],
  selectedRole: null,
  loading: false,
  error: null,

  fetchRoles: async () => {
    set({ loading: true, error: null });
    try {
      const response = await getAllRoles();
      const roles = extractRoles(response);
      const uniqueRoles = [...new Map(
        roles.map((role) => [role.id, role]),
      ).values()];
      set({ roles: uniqueRoles, loading: false });
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, "Failed to load roles.") });
      throw error;
    }
  },

  fetchRoleById: async (id) => {
    set({ loading: true, error: null });
    try {
      const response = await getRoleById(id);
      const role = extractRoles(response)[0] || null;
      set({ selectedRole: role, loading: false });
      return role;
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, "Failed to load role.") });
      throw error;
    }
  },

  fetchRolePrivileges: async () => {
    set({ loading: true, error: null });
    try {
      const response = await getAllRolePrivileges();
      const rolePrivileges = extractRolePrivileges(response);
      set({ rolePrivileges, loading: false, error: null });
      return rolePrivileges;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Failed to load role privileges.");
      set({ rolePrivileges: [], loading: false, error: message });
      throw error;
    }
  },

  assignRolePrivileges: async (payload) => {
    set({ loading: true, error: null });
    try {
      const result = await createRolePrivileges(payload);
      const nextPrivileges = extractRolePrivileges(await getAllRolePrivileges());
      set({ rolePrivileges: nextPrivileges, loading: false, error: null });
      return result;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Failed to assign role privileges.");
      set({ loading: false, error: message });
      throw error;
    }
  },

  addRole: async (payload) => {
    set({ loading: true, error: null });
    try {
      await createRole(payload);
      set({ loading: false });
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, "Failed to create role.") });
      throw error;
    }
  },

  editRole: async (payload) => {
    set({ loading: true, error: null });
    try {
      await updateRole(payload);
      set({ loading: false });
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, "Failed to update role.") });
      throw error;
    }
  },

  removeRole: async (id) => {
    set({ loading: true, error: null });
    try {
      await deleteRole(id);
      set((state) => ({
        roles: state.roles.filter((role) => role.id !== Number(id)),
        selectedRole: state.selectedRole?.id === Number(id) ? null : state.selectedRole,
        loading: false,
      }));
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, "Failed to delete role.") });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));

export default useRolesStore;
