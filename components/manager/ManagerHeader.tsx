"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  CircleHelp,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
} from "lucide-react";
import { useManagerStore as useManagerLayoutStore } from "@/store/managerStore";
import { useNotificationStore } from "@/features/notifications/notification.store";
import useAuthStore from "@/modules/auth/auth.store";

type ProfilePanel = "menu" | "sessions";

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export default function ManagerHeader() {
  const { sidebarCollapsed, toggleSidebar, toggleMobileSidebar } = useManagerLayoutStore();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
  const pathname = usePathname();
  const router = useRouter();
  const profileRootRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [profilePanel, setProfilePanel] = useState<ProfilePanel | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const currentUser = hydrated ? user : null;
  const localePart = pathname.split("/").filter(Boolean)[0];
  const lang = localePart === "am" || localePart === "en" ? localePart : "en";
  const fullName =
    [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(" ").trim() ||
    currentUser?.username?.trim() ||
    "Account";
  const initials =
    fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "A";

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!profilePanel) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !profileRootRef.current?.contains(event.target)) {
        setProfilePanel(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfilePanel(null);
        profileTriggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profilePanel]);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
      router.push(`/${lang}/auth/login`);
    } catch (error: unknown) {
      setLogoutError(error instanceof Error ? error.message : "Unable to sign out.");
    }
  };

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-30 h-[76px] border-b border-slate-200 bg-white transition-all duration-300 ${
        sidebarCollapsed ? "lg:left-[76px]" : "lg:left-[270px]"
      }`}
    >
      <div className="flex h-full items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 lg:flex"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={toggleMobileSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
            <span>Manager</span>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-900">Operations Dashboard</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 sm:hidden"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>

          <div className="hidden w-[220px] md:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search cases..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="group relative">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Help"
              aria-describedby="manager-help-tooltip"
            >
              <CircleHelp className="h-[19px] w-[19px]" />
            </button>
            <span
              id="manager-help-tooltip"
              role="tooltip"
              className="invisible absolute right-0 top-[calc(100%+8px)] z-50 w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
            >
              Contact support through Support Requests in the sidebar.
            </span>
          </div>

          <Link
            href={`/${lang}/admin/manager/notifications`}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
            title="Notifications"
          >
            <Bell className="h-[19px] w-[19px]" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>

          <div className="hidden h-7 w-px bg-slate-200 sm:block" />

          <div ref={profileRootRef} className="relative">
            <button
              ref={profileTriggerRef}
              type="button"
              onClick={() => {
                setLogoutError(null);
                setProfilePanel((current) => current ? null : "menu");
              }}
              aria-expanded={profilePanel !== null}
              aria-haspopup="menu"
              aria-controls="manager-user-menu"
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-100 text-xs font-semibold text-sky-700">
                {initials}
              </span>
              <span className="hidden text-left lg:block">
                <span className="block max-w-[140px] truncate text-xs font-semibold text-slate-800">{fullName}</span>
                <span className="block text-[11px] text-slate-500">Manager / Administrator</span>
              </span>
              <ChevronDown className={`hidden h-4 w-4 text-slate-400 transition-transform lg:block ${profilePanel ? "rotate-180" : ""}`} />
            </button>

            {profilePanel && (
              <div
                id="manager-user-menu"
                role="menu"
                aria-label="User profile menu"
                className="absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
              >
                {profilePanel === "menu" ? (
                  <>
                    <div className="px-3 py-2.5">
                      <p className="truncate text-sm font-bold text-slate-900">{fullName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{currentUser?.roleName || "Manager / Administrator"}</p>
                      {currentUser?.email && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{currentUser.email}</p>
                      )}
                      {currentUser?.branch && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{currentUser.branch}</p>
                      )}
                    </div>
                    <div className="border-t border-slate-100 py-1">
                      <Link
                        href={`/${lang}/admin/manager/profile`}
                        role="menuitem"
                        onClick={() => setProfilePanel(null)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                      >
                        <Settings className="h-4 w-4 text-slate-400" />
                        Profile &amp; security
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setProfilePanel("sessions")}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50"
                      >
                        <Shield className="h-4 w-4 text-slate-400" />
                        Active sessions
                      </button>
                    </div>
                    <div className="border-t border-slate-100 pt-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleLogout()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setProfilePanel("menu")}
                        aria-label="Back to profile menu"
                        className="rounded p-1 text-slate-500 hover:bg-slate-100"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <p className="text-xs font-bold text-slate-800">Active session</p>
                    </div>
                    <div className="px-3 py-3">
                      <p className="text-sm font-semibold text-slate-800">Current browser session</p>
                      <p className="mt-1 break-all text-xs text-slate-500">{currentUser?.email || fullName}</p>
                      <p className="mt-1 text-[11px] text-slate-400">Session details are limited to this signed-in browser.</p>
                    </div>
                    <div className="border-t border-slate-100 pt-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleLogout()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out this session
                      </button>
                    </div>
                  </>
                )}
                {logoutError && <p role="alert" className="px-3 py-2 text-xs text-rose-700">{logoutError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
