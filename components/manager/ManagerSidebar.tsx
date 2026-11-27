"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  History,
  MessageSquare,
  Bell,
  LifeBuoy,
  ChevronDown,
  LogOut,
  BriefcaseBusiness,
  Truck,
  UserRound,
  FileText,
  ArrowRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useManagerStore } from "@/store/managerStore";
import useAuthStore from "@/modules/auth/auth.store";
import { useManagerStore as useManagerServicesStore } from "@/modules/manager/manager.store";

export type ManagerRoleType = "manager" | "administrator" | "supervisor";

const overviewItems = [
  { label: "Dashboard", href: "/admin/manager/dashboard", icon: LayoutDashboard, badge: null },
  { label: "Reports & Analytics", href: "/admin/manager/reports", icon: BarChart3, badge: null },
];

const operationsItems = [
  { label: "Services", href: "/admin/manager/services", icon: BriefcaseBusiness, badge: null },
  { label: "Customers", href: "/admin/manager/customers", icon: Users, badge: null },
  { label: "Staff Management", href: "/admin/manager/team", icon: Users, badge: null },
  { label: "Documents", href: "/admin/manager/documents", icon: FileText, badge: null },
  { label: "Stage Transport", href: "/admin/manager/cases", icon: Truck, badge: null },
];

const governanceItems = [
  { label: "Activity Logs", href: "/admin/manager/activity-logs", icon: History, badge: null },
  { label: "Support Requests", href: "/admin/manager/support", icon: LifeBuoy, badge: null },
];

const communicationItems = [
  { label: "Messages", href: "/admin/manager/messages", icon: MessageSquare, badge: null },
  { label: "Notifications", href: "/admin/manager/notifications", icon: Bell, badge: null },
];

const accountItems = [
  { label: "Profile Settings", href: "/admin/manager/profile", icon: UserRound, badge: null },
];

const demonstrationRoles = [
  { id: "customer", label: "Customer / Importer", href: (locale: string) => `/${locale}/customer/dashboard` },
  { id: "manager", label: "Manager / Administrator", href: (locale: string) => `/${locale}/admin/manager/dashboard` },
  { id: "case-executor", label: "Case Executor", href: (locale: string) => `/${locale}/admin/case-Executer` },
  { id: "assessor", label: "Assessor", href: (locale: string) => `/${locale}/admin/assessor` },
  { id: "data-encoder", label: "Data Encoder", href: (locale: string) => `/${locale}/admin/data-encoder/dashboard` },
];

export default function ManagerSidebar() {
  const pathname = usePathname();
  const params = useParams();
  const lang = (params.lang as string) || "en";
  const router = useRouter();

  const { sidebarCollapsed, mobileSidebarOpen, closeMobileSidebar } = useManagerStore();
  const { logout } = useAuthStore();
  const serviceCount = useManagerServicesStore((state) => state.serviceCount);
  const fetchServices = useManagerServicesStore((state) => state.fetchServices);
  const requestedServiceCount = useRef(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const roleDropdownRef = useRef<HTMLDivElement>(null);
  const roleTriggerRef = useRef<HTMLButtonElement>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    Overview: true,
    Operations: true,
    Governance: true,
    Communication: true,
    Account: true,
  });

  const activeRole = pathname.includes("/customer")
    ? "customer"
    : pathname.includes("/admin/manager")
      ? "manager"
      : pathname.includes("/admin/case-Executer")
        ? "case-executor"
        : pathname.includes("/admin/assessor")
          ? "assessor"
          : "data-encoder";
  const currentRole = demonstrationRoles.find((role) => role.id === activeRole) ?? demonstrationRoles[1];

  useEffect(() => {
    if (serviceCount === 0 && !requestedServiceCount.current) {
      requestedServiceCount.current = true;
      void fetchServices({ page: 1, pageSize: 1 });
    }
  }, [fetchServices, serviceCount]);

  useEffect(() => {
    if (!roleOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !roleDropdownRef.current?.contains(event.target)) {
        setRoleOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRoleOpen(false);
        roleTriggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [roleOpen]);

  const navigationSections = [
    { title: "Overview", items: overviewItems },
    {
      title: "Operations",
      items: operationsItems.map((item) =>
        item.href === "/admin/manager/services"
          ? { ...item, badge: serviceCount ? String(serviceCount) : null }
          : item,
      ),
    },
    { title: "Governance", items: governanceItems },
    { title: "Communication", items: communicationItems },
    { title: "Account", items: accountItems },
  ];

  const isActive = (href: string) => {
    const fullHref = `/${lang}${href}`;
    const managerRoot = `/${lang}/admin/manager`;

    if (href === "/admin/manager/dashboard") {
      return pathname === fullHref || pathname === managerRoot;
    }

    return pathname.startsWith(fullHref);
  };

  const handleLogout = async () => {
    setRoleOpen(false);
    await logout();
    router.push(`/${lang}/auth/login`);
  };

  const renderNavItem = (item: { label: string; href: string; icon: React.ElementType; badge?: string | null }) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const fullHref = `/${lang}${item.href}`;

    return (
      <Link
        key={item.href}
        href={fullHref}
        onClick={closeMobileSidebar}
        title={sidebarCollapsed ? item.label : undefined}
        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          active ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Icon
          className={`h-[19px] w-[19px] shrink-0 ${active ? "text-white" : "text-slate-500 group-hover:text-slate-700"}`}
          strokeWidth={1.9}
        />

        {!sidebarCollapsed && (
          <>
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md bg-[#dfeaf9] px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                {item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  const toggleSection = (title: string) => {
    setExpandedSections((current) => ({
      ...current,
      [title]: !(current[title] ?? true),
    }));
  };

  return (
    <>
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeMobileSidebar}
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
        />
      )}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-dvh w-[270px] flex-col border-r border-slate-200 bg-white transition-all duration-300 lg:h-screen ${sidebarCollapsed ? "lg:w-[76px]" : "lg:w-[270px]"} ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <div className="flex h-[76px] items-center border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm">
              M
            </div>

            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">MOT Import Services</p>
                <p className="text-xs text-slate-500">Operations Portal</p>
              </div>
            )}
          </div>
        </div>

        <nav aria-label="Manager navigation" className="flex-1 overflow-y-auto px-3 py-5">
          {navigationSections.map((section) => {
            const isExpanded = sidebarCollapsed ? true : expandedSections[section.title] ?? true;

            return (
              <div key={section.title} className="mb-5">
                {!sidebarCollapsed && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.title)}
                    className="flex w-full items-center justify-between px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition hover:text-slate-600"
                  >
                    <span>{section.title}</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                )}

                {(sidebarCollapsed || isExpanded) && (
                  <div className="mt-1 space-y-1">
                    {section.items.map(renderNavItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 space-y-2">
          <div ref={roleDropdownRef} className="relative">
            <button
              ref={roleTriggerRef}
              type="button"
              onClick={() => setRoleOpen((open) => !open)}
              title={sidebarCollapsed ? "Prototype role" : undefined}
              aria-expanded={roleOpen}
              aria-haspopup="menu"
              aria-controls="manager-role-menu"
              className={`flex w-full items-center rounded-xl border border-slate-200 bg-slate-50 p-2.5 transition hover:bg-slate-100 ${
                sidebarCollapsed ? "justify-center" : "justify-between"
              }`}
            >
              {sidebarCollapsed && <UserRound className="h-4 w-4 text-slate-500" aria-hidden="true" />}
              {!sidebarCollapsed && (
                <div className="min-w-0 text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Prototype role</p>
                  <p className="truncate text-sm font-bold text-slate-900">
                    {currentRole.label}
                  </p>
                </div>
              )}

              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${roleOpen ? "rotate-180" : ""}`} />
            </button>

            {roleOpen && (
              <div
                id="manager-role-menu"
                role="menu"
                aria-label="Switch workspace"
                className={`absolute bottom-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ${
                  sidebarCollapsed ? "left-0 w-64" : "left-0 right-0"
                }`}
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="text-xs font-bold text-slate-800">Switch workspace</p>
                </div>

                <div className="space-y-0.5 py-1">
                  {demonstrationRoles.map((role) => {
                    const selected = activeRole === role.id;

                    return (
                      <Link
                        key={role.id}
                        href={role.href(lang)}
                        role="menuitem"
                        onClick={() => {
                          setRoleOpen(false);
                          closeMobileSidebar();
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                          selected ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <span>{role.label}</span>
                        {selected && <span className="text-xs text-slate-400">current</span>}
                      </Link>
                    );
                  })}
                </div>

                <div className="mt-1 border-t border-slate-100 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign out</span>
                    <ArrowRight className="ml-auto h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
