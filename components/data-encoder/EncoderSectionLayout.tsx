"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	Bell,
	BriefcaseBusiness,
	ChevronLeft,
	FileDown,
	FileText,
	LayoutDashboard,
	Menu,
	MessageSquare,
	UploadCloud,
	UserCircle,
	UsersRound,
} from "lucide-react";
import EncoderRoleSwitcher from "@/components/data-encoder/EncoderRoleSwitcher";
import { getDataEncoderNavigationCopy } from "@/features/services/service.copy";
import { useMessagingStore } from "@/modules/message/message.store";
import useAuthStore from "@/modules/auth/auth.store";
import {
	ENCODER_DRAFTS_UPDATED_EVENT,
	getEncoderServiceDrafts,
} from "@/modules/dataencoder/data-encoder.drafts";

export type EncoderSection = "dashboard" | "create-customer" | "customers" | "create-service" | "services" | "draft-services" | "documents" | "bulk-upload" | "templates" | "profile" | "messages" | "notifications";

interface EncoderSectionLayoutProps {
	activeSection: EncoderSection;
	title: string;
	description: string;
	descriptionInHeader?: boolean;
	profilePhotoUrl?: string;
	children: ReactNode;
}

const navigation: {
	id: EncoderSection;
	label: string;
	href: (base: string) => string;
	icon: typeof LayoutDashboard;
}[] = [
	{
		id: "dashboard",
		label: "Dashboard",
		href: (base) => `${base}/dashboard`,
		icon: LayoutDashboard,
	},
	{
		id: "draft-services",
		label: "Draft Services",
		href: (base) => `${base}/draft-services`,
		icon: FileText,
	},
	{
		id: "create-customer",
		label: "Create Customer",
		href: (base) => `${base}/customers/new`,
		icon: UsersRound,
	},
	{
		id: "customers",
		label: "Customer List",
		href: (base) => `${base}/customers`,
		icon: UsersRound,
	},
	{
		id: "create-service",
		label: "Create Service",
		href: (base) => `${base}/services/new`,
		icon: BriefcaseBusiness,
	},
	{
		id: "services",
		label: "Services",
		href: (base) => `${base}/services`,
		icon: BriefcaseBusiness,
	},
	{
		id: "documents",
		label: "Documents",
		href: (base) => `${base}/documents`,
		icon: FileText,
	},
	{
		id: "bulk-upload",
		label: "Bulk Upload",
		href: (base) => `${base}/bulk-upload`,
		icon: UploadCloud,
	},
	{
		id: "templates",
		label: "Document Templates",
		href: (base) => `${base}/templates`,
		icon: FileDown,
	},
	{
		id: "messages",
		label: "Messages",
		href: (base) => `${base}/messages`,
		icon: MessageSquare,
	},
	{
		id: "notifications",
		label: "Notifications",
		href: (base) => `${base}/notifications`,
		icon: Bell,
	},
	{
		id: "profile",
		label: "Profile",
		href: (base) => `${base}/profile`,
		icon: UserCircle,
	},
];

export default function EncoderSectionLayout({
	activeSection,
	title,
	description,
	descriptionInHeader = false,
	profilePhotoUrl,
	children,
}: EncoderSectionLayoutProps) {
	const pathname = usePathname();
	const firstSegment = pathname.split("/").filter(Boolean)[0];
	const locale = firstSegment === "am" || firstSegment === "en" ? firstSegment : "en";
	const base = `/${locale}/admin/data-encoder`;
	const copy = getDataEncoderNavigationCopy(locale);
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [draftCount, setDraftCount] = useState(0);
	const unreadCount = useMessagingStore((state) => state.unreadCount);
	const fetchUnreadCount = useMessagingStore((state) => state.fetchUnreadCount);
	const userId = useAuthStore((state) => state.user?.id);

	useEffect(() => {
		const refreshDraftCount = () => {
			try {
				setDraftCount(getEncoderServiceDrafts().length);
			} catch (error: unknown) {
				console.error("Unable to read saved Data Encoder drafts for navigation.", error);
			}
		};
		refreshDraftCount();
		window.addEventListener("storage", refreshDraftCount);
		window.addEventListener(ENCODER_DRAFTS_UPDATED_EVENT, refreshDraftCount);
		return () => {
			window.removeEventListener("storage", refreshDraftCount);
			window.removeEventListener(ENCODER_DRAFTS_UPDATED_EVENT, refreshDraftCount);
		};
	}, []);

	useEffect(() => {
		if (userId !== undefined && userId !== null && userId !== "") {
			void fetchUnreadCount();
		}
	}, [fetchUnreadCount, userId]);

	const localizedNavigation = navigation.map((item) => ({
		...item,
		label: copy[
			({
				"dashboard": "dashboard",
				"draft-services": "draftServices",
				"create-customer": "createCustomer",
				"customers": "customerList",
				"create-service": "createService",
				"services": "services",
				"documents": "documents",
				"bulk-upload": "bulkUpload",
				"templates": "documentTemplates",
				"messages": "messages",
				"notifications": "notifications",
				"profile": "profile",
			} as const)[item.id]
		],
	}));
	const renderNavigationItem = ({
		id,
		label,
		href,
		icon: Icon,
	}: (typeof localizedNavigation)[number]) => {
		const badgeCount = id === "draft-services"
			? draftCount
			: id === "messages"
				? unreadCount
				: 0;
		const hasBadge = id === "draft-services" || id === "messages";
		return (
			<Link
				key={id}
				href={href(base)}
				aria-current={activeSection === id ? "page" : undefined}
				title={collapsed ? label : undefined}
				onClick={() => setMobileOpen(false)}
				className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
					activeSection === id
						? "bg-blue-600 text-white shadow-sm"
						: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
				}`}
			>
				<Icon className={`h-[19px] w-[19px] shrink-0 ${activeSection === id ? "text-white" : "text-slate-500 group-hover:text-slate-700"}`} strokeWidth={1.9} />
				{!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
				{hasBadge && (
					<span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${activeSection === id ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700"}`}>
						{badgeCount > 99 ? "99+" : badgeCount}
					</span>
				)}
			</Link>
		);
	};

	return (
		<div className="min-h-screen bg-slate-50">
			{mobileOpen && (
				<button
					type="button"
					aria-label="Close navigation"
					onClick={() => setMobileOpen(false)}
					className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
				/>
			)}
			<aside
				className={`fixed left-0 top-0 z-40 flex h-dvh flex-col border-r border-slate-200 bg-white transition-all duration-300 lg:h-screen ${
					collapsed ? "w-[76px]" : "w-[270px]"
				} ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
			>
				<div className="flex h-[76px] items-center justify-between border-b border-slate-200 px-4">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm">
							M
						</div>
						{!collapsed && (
							<div className="min-w-0">
								<p className="truncate text-sm font-bold text-slate-900">MOT Import Services</p>
								<p className="text-xs text-slate-500">Data Operations</p>
							</div>
						)}
					</div>
					<button
						type="button"
						aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						onClick={() => setCollapsed((value) => !value)}
						className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 lg:flex"
					>
						<ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
					</button>
				</div>
				<nav aria-label="Data Encoder navigation" className="flex-1 overflow-y-auto px-3 py-5">
					<p className={`mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${collapsed ? "sr-only" : ""}`}>
						{copy.overview}
					</p>
					<div className="space-y-1">
						{localizedNavigation.slice(0, 2).map(renderNavigationItem)}
					</div>
					<p className={`mb-2 mt-7 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${collapsed ? "sr-only" : ""}`}>
						{copy.dataEntry}
					</p>
					<div className="space-y-1">
						{localizedNavigation.slice(2, 6).map(renderNavigationItem)}
					</div>
					<p className={`mb-2 mt-7 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${collapsed ? "sr-only" : ""}`}>
						{copy.documents}
					</p>
					<div className="space-y-1">
						{localizedNavigation.slice(6, 9).map(renderNavigationItem)}
					</div>
					<p className={`mb-2 mt-7 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${collapsed ? "sr-only" : ""}`}>
						{copy.communication}
					</p>
					<div className="space-y-1">
						{localizedNavigation.slice(9).map(renderNavigationItem)}
					</div>
				</nav>
				<div className="border-t border-slate-200 p-3">
					<EncoderRoleSwitcher
						collapsed={collapsed}
						profilePhotoUrl={profilePhotoUrl}
					/>
				</div>
			</aside>

			<div className={`min-h-screen transition-all duration-300 ${collapsed ? "lg:pl-[76px]" : "lg:pl-[270px]"}`}>
				<header className="sticky top-0 z-20 flex min-h-[76px] items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
					<button
						type="button"
						aria-label="Open navigation"
						aria-expanded={mobileOpen}
						onClick={() => setMobileOpen(true)}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 lg:hidden"
					>
						<Menu className="h-5 w-5" />
					</button>
					<div className="min-w-0">
						<p className="text-xs font-medium text-slate-500">Data Encoder</p>
						<h1 className="truncate text-sm font-semibold text-slate-900">{title}</h1>
						{descriptionInHeader && <p className="text-xs text-slate-500">{description}</p>}
					</div>
				</header>
				<main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
					{!descriptionInHeader && <p className="text-sm text-slate-500">{description}</p>}
					{children}
				</main>
			</div>
		</div>
	);
}
