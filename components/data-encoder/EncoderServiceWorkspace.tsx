"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
	AlertCircle,
	ArrowLeft,
	Bell,
	Check,
	Circle,
	Clock3,
	FileText,
	HelpCircle,
	LoaderCircle,
	MapPin,
	MessageSquare,
	Plane,
	Search,
	ShieldCheck,
	Ship,
	Upload,
	X,
} from "lucide-react";
import { useNotificationStore } from "@/features/notifications/notification.store";
import { useMessagingStore } from "@/modules/message/message.store";
import type { UserMessage } from "@/modules/message/message.type";
import useAuthStore from "@/modules/auth/auth.store";
import { DataEncoderEndpoints } from "@/modules/dataencoder/data-encoder.endpoint";
import { normalizeEncoderServiceMode } from "@/modules/dataencoder/service-mode";
import EncoderSectionLayout from "@/components/data-encoder/EncoderSectionLayout";

type DataRecord = Record<string, unknown>;
type WorkspaceTab = "stage" | "documents" | "discussion" | "consignment";
type AssessmentFields = {
	dpv: string;
	duty: string;
	withholding: string;
	vat: string;
	surtax: string;
	noticeNumber: string;
};
type ServiceDocument = DataRecord & { id: string; name: string; documentIdValue?: string };
type DocumentPreview = {
	document: ServiceDocument;
	name: string;
	url: string | null;
	type: string;
	status: "loading" | "ready" | "missing";
	localOnly?: boolean;
};
type StoredLocalDocument = { key: string; file: Blob; name: string; type: string; size: number; serverSynced?: boolean };

interface StageRecord extends DataRecord {
	id: string;
	name: string;
	status: string;
	order: number;
}

const isAssessmentStageRecord = (stage: StageRecord | null): stage is StageRecord =>
	Boolean(stage && (
		stage.order === 8 ||
		stage.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "").includes("assessmenttaxpayment")
	));

const emptyAssessment: AssessmentFields = {
	dpv: "",
	duty: "",
	withholding: "",
	vat: "",
	surtax: "",
	noticeNumber: "",
};

const findRecordValue = (value: unknown, ...names: string[]): unknown =>
	isRecord(value) ? findValue(value, ...names) : undefined;

const readNoteField = (notes: string, field: string): string => {
	const prefix = `${field.toLowerCase()}:`;
	const line = notes.split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(prefix));
	return line?.trim().slice(prefix.length).trim() ?? "";
};

const isRecord = (value: unknown): value is DataRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const findValue = (record: DataRecord, ...names: string[]): unknown => {
	const key = Object.keys(record).find((candidate) =>
		names.some((name) => name.toLowerCase() === candidate.toLowerCase()),
	);
	return key ? record[key] : undefined;
};

const findPreferredValue = (record: DataRecord, ...names: string[]): unknown => {
	for (const name of names) {
		const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
		if (key && record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
	}
	return undefined;
};

const readText = (...values: unknown[]): string => {
	const value = values.find((candidate) =>
		(typeof candidate === "string" && candidate.trim()) ||
		typeof candidate === "number" ||
		isRecord(candidate),
	);
	if (typeof value === "string" || typeof value === "number") return String(value).trim();
	if (isRecord(value)) {
		return readText(findValue(value, "name", "businessName", "fullName", "displayName", "value"));
	}
	return "";
};

const unwrapRecords = (value: unknown, listNames: string[]): DataRecord[] => {
	let current = value;
	for (let depth = 0; depth < 8; depth += 1) {
		if (Array.isArray(current)) {
			if (!current.every(isRecord)) throw new Error("The service API returned an invalid record list.");
			return current;
		}
		if (!isRecord(current)) break;
		const listKey = Object.keys(current).find((key) =>
			listNames.some((name) => name.toLowerCase() === key.toLowerCase()),
		);
		const envelopeKey = Object.keys(current).find((key) =>
			["data", "payload", "response", "result"].includes(key.toLowerCase()),
		);
		const nextKey = listKey ?? envelopeKey;
		if (!nextKey || current[nextKey] === current) break;
		current = current[nextKey];
	}
	throw new Error("The service API response did not contain a record list.");
};

const normalizeStageStatus = (value: unknown): string => {
	const normalized = readText(isRecord(value) ? findValue(value, "name", "label", "status", "value", "id") : value)
		.toLowerCase()
		.replaceAll(/[\s_-]+/g, "");
	if (["4", "completed", "complete", "done"].includes(normalized)) return "completed";
	if (["6", "needsreview", "review", "underreview"].includes(normalized)) return "needs_review";
	if (["3", "inprogress", "active"].includes(normalized)) return "in_progress";
	if (["5", "blocked"].includes(normalized)) return "blocked";
	if (["2", "pending"].includes(normalized)) return "pending";
	return "not_started";
};

const multimodalStageNames = [
	"Prepayment Invoice",
	"Transit Permission",
	"Amendment",
	"Drop Risk",
	"Delivery Order",
	"Warehouse Status",
	"Inspection",
	"Assessment & Tax Payment",
	"Emergency / Spot",
	"Exit & Storage Payment",
	"Transportation",
	"Clearance",
] as const;

const unimodalStageNames = ["Local Permission", "Arrival", "Clearance Request"] as const;

const getDefaultStageNames = (mode: unknown): readonly string[] => {
	const serviceMode = normalizeEncoderServiceMode(mode);
	if (serviceMode === "Unimodal") return unimodalStageNames;
	if (serviceMode === "Multimodal") return multimodalStageNames;
	return [];
};

const getDefaultStageName = (index: number, mode: unknown): string =>
	getDefaultStageNames(mode)[index] ?? `Stage ${index + 1}`;

const readStages = (value: unknown, mode: unknown): StageRecord[] =>
	unwrapRecords(value, ["stages", "items", "records", "rows", "results"])
		.map((stage, index) => {
			const stageInfo = findValue(stage, "stage");
			const id = readText(findValue(stage, "id", "serviceStageId", "shipmentStageId", "stageExecutionId"));
			const order = Number(findValue(stage, "order", "stageOrder", "sequence")) || index + 1;
			const inferredName = readText(
				findValue(stage, "stageName", "name"),
				...(isRecord(stageInfo) ? [findValue(stageInfo, "name", "stageName")] : []),
			);
			const stageIndex = Math.max(0, order - 1);
			const stageName = /^stage\s*\d+$/i.test(inferredName)
				? getDefaultStageName(stageIndex, mode)
				: inferredName || getDefaultStageName(stageIndex, mode);
			return {
				...stage,
				id: id || `stage-${index + 1}`,
				name: stageName,
				status: normalizeStageStatus(findValue(stage, "status", "stageStatus", "currentStatus")),
				order,
			};
		})
		.sort((left, right) => left.order - right.order);

const statusLabel = (status: string): string => ({
	completed: "Completed",
	needs_review: "Needs review",
	in_progress: "In progress",
	blocked: "Blocked",
	pending: "Pending",
	not_started: "Not started",
}[status] ?? "Not started");

const unwrapDocumentList = (value: unknown): DataRecord[] => {
	if (value === null || value === undefined || value === "") return [];
	return unwrapRecords(value, ["documents", "serviceDocuments", "attachments", "items", "records", "rows", "results"]);
};

const mapDocument = (document: DataRecord, index: number): ServiceDocument => ({
	...document,
	id: readText(findValue(document, "documentId", "id", "attachmentId")) || `document-${index + 1}`,
	documentIdValue: readText(findValue(document, "documentId", "id", "attachmentId")) || undefined,
	name: readText(findValue(document, "fileName", "documentName", "name", "title", "originalFileName")) || `Document ${index + 1}`,
});

const openLocalDocumentDatabase = (): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = window.indexedDB.open("mot-document-preview", 1);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains("files")) {
				database.createObjectStore("files", { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Local document storage could not be opened."));
		request.onblocked = () => reject(new Error("Local document storage is blocked by another browser tab."));
	});

const storeLocalDocument = async (item: StoredLocalDocument): Promise<void> => {
	if (!("indexedDB" in window)) throw new Error("This browser does not support persistent local document storage.");
	const database = await openLocalDocumentDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction("files", "readwrite");
			transaction.objectStore("files").put(item);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error ?? new Error("The document could not be saved in browser storage."));
			transaction.onabort = () => reject(transaction.error ?? new Error("Saving the document in browser storage was interrupted."));
		});
	} finally {
		database.close();
	}
};

const readLocalDocument = async (key: string): Promise<StoredLocalDocument | null> => {
	if (!("indexedDB" in window)) return null;
	const database = await openLocalDocumentDatabase();
	try {
		return await new Promise<StoredLocalDocument | null>((resolve, reject) => {
			const request = database.transaction("files", "readonly").objectStore("files").get(key);
			request.onsuccess = () => {
				const result: unknown = request.result;
				if (!isRecord(result) || !(result.file instanceof Blob)) {
					resolve(null);
					return;
				}
				resolve({
					key,
					file: result.file,
					name: readText(result.name) || "document.pdf",
					type: readText(result.type) || "application/pdf",
					size: typeof result.size === "number" ? result.size : result.file.size,
					serverSynced: result.serverSynced === true,
				});
			};
			request.onerror = () => reject(request.error ?? new Error("The browser-stored document could not be read."));
		});
	} finally {
		database.close();
	}
};

const getLocalDocumentKey = (serviceId: string, document: ServiceDocument): string =>
	`${serviceId}:${document.documentIdValue || document.id}`;

const getErrorMessage = (error: unknown): string =>
	error instanceof Error && error.message.trim()
		? error.message
		: typeof error === "string" && error.trim()
			? error
			: "Unable to load this service.";

const formatDate = (value: unknown): string => {
	const text = readText(value);
	if (!text) return "Not available";
	const date = new Date(text);
	return Number.isNaN(date.getTime())
		? text
		: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const readAssessmentDraft = (serviceId: string): AssessmentFields => {
	const stored = window.localStorage.getItem(`draft_${serviceId}`);
	if (!stored) return emptyAssessment;
	const parsed: unknown = JSON.parse(stored);
	if (!isRecord(parsed)) throw new Error("Saved assessment drafts are invalid.");
	return {
		dpv: typeof parsed.dpv === "string" ? parsed.dpv : "",
		duty: typeof parsed.duty === "string" ? parsed.duty : "",
		withholding: typeof parsed.withholding === "string" ? parsed.withholding : "",
		vat: typeof parsed.vat === "string" ? parsed.vat : "",
		surtax: typeof parsed.surtax === "string" ? parsed.surtax : "",
		noticeNumber: typeof parsed.noticeNumber === "string" ? parsed.noticeNumber : "",
	};
};

const saveAssessmentDraft = (serviceId: string, fields: AssessmentFields): void => {
	window.localStorage.setItem(`draft_${serviceId}`, JSON.stringify({
		...fields,
		updatedAt: new Date().toISOString(),
	}));
};

const removeAssessmentDraft = (serviceId: string): void => {
	window.localStorage.removeItem(`draft_${serviceId}`);
};

const getNumericId = (value: unknown): string => {
	const text = readText(value);
	return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : "";
};

const getDocumentId = (document: ServiceDocument): string => document.documentIdValue ?? "";

const normalizeRiskLabel = (value: unknown): string => {
	const risk = readText(value);
	if (/^\d+$/.test(risk)) {
		return ({
			"1": "Blue channel",
			"2": "Green channel",
			"3": "Yellow channel",
			"4": "Red channel",
		} as Record<string, string>)[risk] ?? risk;
	}
	const normalized = risk.toLowerCase();
	if (normalized.includes("yellow")) return "Yellow channel";
	if (normalized.includes("red")) return "Red channel";
	if (normalized.includes("blue")) return "Blue channel";
	if (normalized.includes("green")) return "Green channel";
	return risk;
};

const normalizeServiceStatus = (value: unknown): string => {
	const status = readText(value);
	if (!/^\d+$/.test(status)) {
		if (status.toLowerCase().replaceAll(/[\s_-]+/g, "") === "underreview") return "Under review";
		return status;
	}
	return ({
		"1": "Draft",
		"2": "Submitted",
		"3": "Under review",
		"4": "Approved",
		"5": "In progress",
		"6": "Completed",
		"7": "Rejected",
		"8": "Cancelled",
		"9": "Delivered",
	} as Record<string, string>)[status] ?? status;
};

const personName = (value: unknown): string => {
	if (isRecord(value)) {
		return [
			readText(findValue(value, "firstName", "givenName")),
			readText(findValue(value, "lastName", "surname")),
		].filter(Boolean).join(" ") || readText(findValue(value, "name", "fullName", "username"));
	}
	return readText(value);
};

const initials = (value: string): string =>
	value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "DE";

const amountInputClass = "mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export default function EncoderServiceWorkspace() {
	const params = useParams<Record<string, string | string[]>>();
	const pathname = usePathname();
	const router = useRouter();
	const searchRef = useRef<HTMLInputElement>(null);
	const uploadInputRef = useRef<HTMLInputElement>(null);
	const previewUploadRef = useRef<HTMLInputElement>(null);
	const previewRequestIdRef = useRef(0);
	const routeServiceId = Array.isArray(params.serviceId)
		? params.serviceId[0]
		: params.serviceId ?? (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
	const legacyRoute = pathname.startsWith("/en/") || pathname.startsWith("/am/");
	const user = useAuthStore((state) => state.user);
	const notifications = useNotificationStore((state) => state.notifications);
	const unreadNotificationCount = useNotificationStore((state) => state.unreadCount);
	const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
	const notificationError = useNotificationStore((state) => state.error);
	const messages = useMessagingStore((state) => state.serviceMessages);
	const messagingError = useMessagingStore((state) => state.error);
	const fetchServiceMessages = useMessagingStore((state) => state.fetchServiceMessages);
	const sendMessage = useMessagingStore((state) => state.sendMessage);
	const [services, setServices] = useState<DataRecord[]>([]);
	const [service, setService] = useState<DataRecord | null>(null);
	const [stages, setStages] = useState<StageRecord[]>([]);
	const [documents, setDocuments] = useState<ServiceDocument[]>([]);
	const [documentsError, setDocumentsError] = useState<string | null>(null);
	const [selectedStageId, setSelectedStageId] = useState("");
	const [activeTab, setActiveTab] = useState<WorkspaceTab>("stage");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionNotice, setActionNotice] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [notificationsOpen, setNotificationsOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [assessmentFields, setAssessmentFields] = useState<AssessmentFields>(emptyAssessment);
	const [recentAssessmentSubmissionAt, setRecentAssessmentSubmissionAt] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [messageText, setMessageText] = useState("");
	const [messageSending, setMessageSending] = useState(false);
	const [messageError, setMessageError] = useState<string | null>(null);
	const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [previewUploading, setPreviewUploading] = useState(false);
	const [previewUploadError, setPreviewUploadError] = useState<string | null>(null);
	const [uploadRequirement, setUploadRequirement] = useState("");
	const [preview, setPreview] = useState<DocumentPreview | null>(null);

	const loadService = useCallback(async () => {
		if (!routeServiceId) {
			setError("A service reference is required.");
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		setDocumentsError(null);
		try {
			const servicesResponse = await DataEncoderEndpoints.getServices();
			const serviceList = unwrapRecords(servicesResponse, ["services", "items", "records", "serviceList", "shipments", "rows"]);
			const record = serviceList.find((item) =>
				readText(findPreferredValue(item, "id", "serviceId", "shipmentId")) === routeServiceId ||
				readText(findPreferredValue(item, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber", "declarationReference")) === routeServiceId,
			);
			if (!record) throw new Error(`Service ${routeServiceId} was not found in the available service records.`);
			const backendServiceId = getNumericId(findValue(record, "id", "serviceId", "shipmentId"));
			if (!backendServiceId) throw new Error("This service record does not contain a valid backend service ID.");
			const [stagesResult, documentsResult] = await Promise.allSettled([
				DataEncoderEndpoints.getServiceStages(backendServiceId),
				DataEncoderEndpoints.getServiceDocuments(backendServiceId),
			]);
			if (stagesResult.status === "rejected") {
				throw new Error(`Service stages could not be loaded: ${getErrorMessage(stagesResult.reason)}`);
			}
			const loadedStages = readStages(
				stagesResult.value,
				findValue(record, "mode", "serviceType"),
			);
			const stageDocuments = [
				...loadedStages.flatMap((stage) => {
					const value = findValue(stage, "documents", "stageDocuments", "attachments");
					return Array.isArray(value) ? value.filter(isRecord) : [];
				}),
			];
			let rawDocs: DataRecord[] = [];
			if (documentsResult.status === "fulfilled") {
				try {
					const responseData = isRecord(documentsResult.value) && "data" in documentsResult.value
						? documentsResult.value.data
						: documentsResult.value;
					rawDocs = unwrapDocumentList(responseData);
					setDocumentsError(null);
				} catch (documentsParseError: unknown) {
					setDocumentsError(`Service documents could not be read: ${getErrorMessage(documentsParseError)}`);
				}
			} else {
				setDocumentsError(`Service documents could not be loaded: ${getErrorMessage(documentsResult.reason)}`);
			}
			const serviceDocValue = findValue(record, "documents", "serviceDocuments", "attachments");
			const serviceDocs = Array.isArray(serviceDocValue) ? serviceDocValue.filter(isRecord) : [];
			const allDocs = [...serviceDocs, ...rawDocs, ...stageDocuments];
			const uniqueDocs = new Map<string, ServiceDocument>();
			allDocs.forEach((doc, index) => {
				const mapped = mapDocument(doc, index);
				const key = getDocumentId(mapped) || `${mapped.name}-${index}`;
				uniqueDocs.set(key, mapped);
			});
			setServices(serviceList);
			setService(record);
			setStages(loadedStages);
			setDocuments([...uniqueDocs.values()]);
			const activeStage = loadedStages.find((stage) =>
				["in_progress", "needs_review", "blocked", "pending"].includes(stage.status),
			);
			setSelectedStageId((current) =>
				loadedStages.some((stage) => stage.id === current) ? current : activeStage?.id ?? loadedStages[0]?.id ?? "",
			);
			try {
				const reference = readText(findPreferredValue(record, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber")) || backendServiceId;
				const savedDraft = readAssessmentDraft(reference);
				const assessment = findValue(record, "assessment", "taxAssessment", "assessmentDetails");
				const assessmentRecord = isRecord(assessment) ? assessment : {};
				setAssessmentFields({
					dpv: savedDraft.dpv || readText(findValue(assessmentRecord, "dutyPayingValue", "dpv", "cif")),
					duty: savedDraft.duty || readText(findValue(assessmentRecord, "customsDuty", "dutyAmount", "duty")),
					withholding: savedDraft.withholding || readText(findValue(assessmentRecord, "withholdingTax", "withholdingAmount")),
					vat: savedDraft.vat || readText(findValue(assessmentRecord, "vat", "vatAmount")),
					surtax: savedDraft.surtax || readText(findValue(assessmentRecord, "surTax", "surtax", "surTaxAmount")),
					noticeNumber: savedDraft.noticeNumber || readText(findValue(assessmentRecord, "taxAssessmentNoticeNumber", "noticeNumber", "assessmentNumber")),
				});
			} catch (draftError: unknown) {
				setAssessmentFields(emptyAssessment);
				setActionError(`The saved assessment draft could not be loaded: ${getErrorMessage(draftError)}`);
			}
		} catch (loadError: unknown) {
			setService(null);
			setStages([]);
			setDocuments([]);
			setError(getErrorMessage(loadError));
		} finally {
			setLoading(false);
		}
	}, [routeServiceId]);

	const currentServiceId = service
		? getNumericId(findValue(service, "id", "serviceId", "shipmentId"))
		: "";
	const serviceDraftKey = service
		? readText(findPreferredValue(service, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber")) || currentServiceId
		: "";
	const displayMessages = messages;

	useEffect(() => {
		const timeoutId = window.setTimeout(() => void loadService(), 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadService]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				searchRef.current?.focus();
				setSearchOpen(true);
			}
			if (event.key === "Escape") {
				setSearchOpen(false);
				setNotificationsOpen(false);
				setHelpOpen(false);
				setMessageDrawerOpen(false);
				previewRequestIdRef.current += 1;
				setPreview(null);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if (!actionNotice) return;
		const timeoutId = window.setTimeout(() => setActionNotice(null), 4500);
		return () => window.clearTimeout(timeoutId);
	}, [actionNotice]);

	useEffect(() => {
		if (!recentAssessmentSubmissionAt) return;
		const timeoutId = window.setTimeout(() => setRecentAssessmentSubmissionAt(null), 60_000);
		return () => window.clearTimeout(timeoutId);
	}, [recentAssessmentSubmissionAt]);

	useEffect(() => {
		if (activeTab === "discussion" && currentServiceId) {
			void fetchServiceMessages(currentServiceId);
		}
	}, [activeTab, currentServiceId, fetchServiceMessages]);

	useEffect(() => () => {
	if (preview?.url) URL.revokeObjectURL(preview.url);
	}, [preview?.url]);

	const selectedStage = stages.find((stage) => stage.id === selectedStageId) ?? null;
	const currentStageIndex = selectedStage ? stages.findIndex((stage) => stage.id === selectedStage.id) : -1;
	const previousStage = currentStageIndex > 0 ? stages[currentStageIndex - 1] : null;
	const isAssessmentStage = isAssessmentStageRecord(selectedStage);
	const isAssessmentLocked = selectedStage?.status === "needs_review" || selectedStage?.status === "completed";
	const completedStages = stages.filter((stage) => stage.status === "completed").length;
	const progress = stages.length ? Math.round(completedStages / stages.length * 100) : 0;
	const activeStageIndex = stages.findIndex((stage) =>
		["in_progress", "needs_review", "blocked"].includes(stage.status),
	);
	const currentStageNumber = stages.length
		? activeStageIndex >= 0
			? activeStageIndex + 1
			: Math.min(completedStages + 1, stages.length)
		: 0;
	const trackingNumber = service
		? readText(findPreferredValue(service, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber", "id"))
		: routeServiceId;
	const declarationReference = service
		? readText(findValue(service, "internalReference", "internalRef", "declarationReference", "declarationNumber", "customsDeclarationNumber"))
		: "";
	const title = service
		? readText(findValue(service, "description", "itemDescription", "serviceDescription"))
		: "";
	const importerValue = service
		? findValue(service, "importer", "customer", "customerName", "importerName", "importerBusinessName")
		: undefined;
	const importerRecord = isRecord(importerValue) ? importerValue : {};
	const serviceNotes = service ? readText(findValue(service, "notes", "serviceNotes")) : "";
	const importerNote = readNoteField(serviceNotes, "Importer");
	const noteImporterName = importerNote.replace(/\s*\(TIN:\s*[^)]+\)\s*$/i, "").trim();
	const noteTin = importerNote.match(/\(TIN:\s*([^)]+)\)/i)?.[1]?.trim() ?? "";
	const importerUser = findValue(importerRecord, "user", "account", "contactUser");
	const importerContact = findValue(importerRecord, "contactPerson", "contact", "primaryContact")
		|| readNoteField(serviceNotes, "Contact");
	const importerName = readText(
		importerValue,
		service ? findValue(service, "businessName", "companyName", "importerBusinessName", "customerBusinessName") : "",
	) || noteImporterName || "Importer details unavailable";
	const importerCode = readText(
		findValue(importerRecord, "customerCode", "code", "customerNumber"),
		service ? findValue(service, "customerCode", "customerReference") : "",
	);
	const importerTin = readText(
		findValue(importerRecord, "tinNumber", "tin", "taxIdentificationNumber"),
		service ? findValue(service, "tinNumber", "tin", "importerTin", "importerTIN") : "",
	) || noteTin;
	const contactName = personName(importerContact) || personName(importerUser);
	const contactPhone = readText(findRecordValue(importerContact, "phone", "phoneNumber", "mobile"))
		|| readText(findRecordValue(importerUser, "phone", "phoneNumber", "mobile"))
		|| readText(findValue(importerRecord, "phone", "phoneNumber", "contactPhone"))
		|| readNoteField(serviceNotes, "Phone");
	const importerUserId = readText(
		findRecordValue(importerUser, "userId", "id"),
		findValue(importerRecord, "importerUserId", "userId"),
		service ? findValue(service, "importerUserId") : "",
	);
	const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || user?.email?.split("@")[0] || "Data Encoder";
	const riskValue = service ? findValue(service, "riskChannel", "riskLevel", "channel", "risk", "channelType") : undefined;
	const riskLabel = normalizeRiskLabel(riskValue);
	const riskTone = riskLabel.toLowerCase().includes("yellow")
		? "border-amber-200 bg-amber-50 text-amber-800"
		: riskLabel.toLowerCase().includes("red")
			? "border-rose-200 bg-rose-50 text-rose-800"
			: riskLabel.toLowerCase().includes("blue")
				? "border-sky-200 bg-sky-50 text-sky-800"
					: riskLabel.toLowerCase().includes("green")
						? "border-emerald-200 bg-emerald-50 text-emerald-800"
				: "border-slate-200 bg-slate-100 text-slate-700";
	const rawMode = service
		? findValue(
				service,
				"mode",
				"serviceType",
				"serviceTypeName",
				"serviceTypeId",
				"transportMode",
				"transportModeName",
				"transportModeId",
			)
		: undefined;
	const workflowName = normalizeEncoderServiceMode(rawMode) || readText(rawMode) || "Not specified";
	const riskGuidance = riskLabel.toLowerCase().includes("yellow")
		? "Documentary review required before release. Assessor sign-off is mandatory."
		: riskLabel.toLowerCase().includes("red")
			? "Full physical inspection and verification are required before release."
			: "Routine handling. Post-clearance audit may apply.";
	const serviceStatus = normalizeServiceStatus(service ? findValue(service, "status", "serviceStatus", "approvalStatus", "recordStatus") : "");
	const serviceStatusTone = /complete|approv|deliver/i.test(serviceStatus)
		? "border-emerald-200 bg-emerald-50 text-emerald-800"
		: /progress/i.test(serviceStatus)
			? "border-cyan-200 bg-cyan-50 text-cyan-800"
		: /review|pending|submitt/i.test(serviceStatus)
			? "border-amber-200 bg-amber-50 text-amber-800"
			: /reject|block|cancel/i.test(serviceStatus)
				? "border-rose-200 bg-rose-50 text-rose-800"
				: "border-slate-200 bg-slate-50 text-slate-700";
	const assignedExecutor = service ? findValue(service, "assignedCaseExecutor", "caseExecutor", "caseOwner") : undefined;
	const assignedAssessor = service ? findValue(service, "assignedAssessor", "assessor") : undefined;
	const origin = service ? readText(findValue(service, "origin", "countryOfOrigin", "originName")) : "";
	const destination = service ? readText(findValue(service, "destination", "destinationName", "assignedHub")) : "";
	const transitPort = service ? readText(findValue(service, "transitPort", "transitPortName", "transitHub")) : "";
	const eta = service ? readText(findValue(service, "eta", "estimatedArrival", "arrivalDate", "dueDate")) : "";
	const etaLabel = /^\d{4}-\d{2}-\d{2}$/.test(eta) ? eta : formatDate(eta);
	const vessel = service ? readText(findValue(service, "vessel", "vesselName", "shipName")) : "";
	const voyage = service ? readText(findValue(service, "voyage", "voyageNumber")) : "";
	const flightNumber = service ? readText(findValue(service, "flightNumber", "flight", "airwayBillFlightNumber")) : "";
	const carrier = service ? readText(findValue(service, "carrier", "airline", "carrierName", "airlineName")) : "";
	const filteredServices = useMemo(() => {
		const normalizedQuery = search.trim().toLowerCase();
		if (!normalizedQuery) return [];
		return services.filter((item) =>
			[
				findPreferredValue(item, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber", "id"),
				findValue(item, "description", "itemDescription", "serviceDescription"),
				findValue(item, "importer", "customerName", "importerName"),
			].some((value) => readText(value).toLowerCase().includes(normalizedQuery)),
		).slice(0, 6);
	}, [search, services]);
	const filteredDocuments = useMemo(() => {
		const normalizedQuery = search.trim().toLowerCase();
		if (!normalizedQuery) return [];
		return documents.filter((document) =>
			[document.name, findValue(document, "documentType", "type", "category")]
				.some((value) => readText(value).toLowerCase().includes(normalizedQuery)),
		).slice(0, 4);
	}, [documents, search]);
	const tabItems: { id: WorkspaceTab; label: string; count?: number }[] = [
		{ id: "stage", label: "Stage work" },
		{ id: "documents", label: "Documents", count: documents.length },
		{ id: "discussion", label: "Discussion", count: displayMessages.length },
		{ id: "consignment", label: "Consignment" },
	];
	const previousNotes = previousStage
		? readText(findValue(previousStage, "notes", "summary", "remarks", "description"))
		: "";
	const previousInspector = previousStage
		? personName(findValue(previousStage, "inspector", "assignedInspector", "completedBy"))
		: "";
	const previousCompletedAt = previousStage
		? findValue(previousStage, "completedAt", "updatedAt", "updatedDate")
		: undefined;
	const previousDuration = previousStage
		? readText(findValue(previousStage, "duration", "durationHours", "elapsedTime"))
		: "";
	const stageRequirements = selectedStage
		? findValue(selectedStage, "requiredDocuments", "documentRequirements", "requiredDocumentTypes")
		: undefined;
	const serviceRequirements = service
		? findValue(service, "requiredDocuments", "documentRequirements", "requiredDocumentTypes")
		: undefined;
	const requiredDocumentValues = Array.isArray(stageRequirements) && stageRequirements.length
		? stageRequirements
		: isAssessmentStage
			? ["Commercial invoice", "Valuation worksheet"]
			: stageRequirements ?? serviceRequirements;
	const requiredDocumentNames = Array.isArray(requiredDocumentValues)
		? requiredDocumentValues.flatMap((requirement) => {
			const name = isRecord(requirement)
				? readText(findValue(requirement, "name", "documentName", "documentType", "title", "label", "type"))
				: readText(requirement);
			return name ? [name] : [];
		})
		: [];
	const isDocumentReceived = (requiredName: string): boolean => {
		const normalizedRequirement = requiredName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
		return documents.some((document) => {
			const documentStatus = readText(findValue(document, "status", "documentStatus", "verificationStatus"))
				.toLowerCase().replaceAll(/[\s_-]+/g, "");
			if (["outstanding", "pending", "pendingvalidation", "rejected", "notreceived"].includes(documentStatus)) {
				return false;
			}
			const documentNames = [
				findValue(document, "documentType", "type", "category"),
				document.name,
			].map((value) => readText(value).toLowerCase().replaceAll(/[^a-z0-9]+/g, ""));
			return documentNames.some((name) => Boolean(name) && (
				name === normalizedRequirement ||
				name.includes(normalizedRequirement) ||
				normalizedRequirement.includes(name)
			));
		});
	};
	const receivedRequirementCount = requiredDocumentNames.filter((requiredName) => {
		return isDocumentReceived(requiredName);
	}).length;
	const taxTotal = ["duty", "withholding", "vat", "surtax"].reduce((sum, key) => {
		const amount = Number(assessmentFields[key as keyof AssessmentFields]);
		return sum + (Number.isFinite(amount) ? amount : 0);
	}, 0);
	const activities = useMemo(() =>
		stages.map((stage) => ({
			id: stage.id,
			name: stage.name,
			status: statusLabel(stage.status),
			date: findValue(stage, "updatedAt", "updatedDate", "completedAt", "createdAt", "createAt"),
			note: readText(findValue(stage, "notes", "summary", "remarks", "description")),
		})).filter((item) => item.date || item.note || item.status === "Completed")
			.sort((first, second) => {
				const firstTime = first.date ? new Date(readText(first.date)).getTime() : 0;
				const secondTime = second.date ? new Date(readText(second.date)).getTime() : 0;
				return secondTime - firstTime;
			}).slice(0, 5),
	[stages]);

	const backHref = legacyRoute
		? `/${pathname.split("/")[1]}/admin/data-encoder/services`
		: "/encoder/services";

	const selectService = (item: DataRecord) => {
		const reference = readText(findPreferredValue(item, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber", "id", "serviceId"));
		if (!reference) return;
		setSearchOpen(false);
		setSearch("");
		router.push(`/encoder/services/${encodeURIComponent(reference)}`);
	};

	const updateAssessment = (key: keyof AssessmentFields, value: string) => {
		setAssessmentFields((current) => ({ ...current, [key]: value }));
		setActionError(null);
		setActionNotice(null);
	};

	const handleSaveDraft = () => {
		if (!serviceDraftKey) {
			setActionError("A service reference is required to save this assessment.");
			return;
		}
		try {
			saveAssessmentDraft(serviceDraftKey, assessmentFields);
			setActionError(null);
			setActionNotice("Draft assessment values saved locally.");
		} catch (saveError: unknown) {
			setActionNotice(null);
			setActionError(getErrorMessage(saveError));
		}
	};

	const handleSubmitAssessment = async () => {
		if (!currentServiceId || !isAssessmentStageRecord(selectedStage)) {
			setActionError("A valid service ID is required to submit this assessment.");
			return;
		}
		if (selectedStage.status !== "in_progress") {
			setActionError("The Assessment & Tax Payment stage must be in progress before it can be submitted.");
			return;
		}
		if (assessmentFields.dpv.trim() && (!Number.isFinite(Number(assessmentFields.dpv)) || Number(assessmentFields.dpv) < 0)) {
			setActionError("Duty Paying Value (DPV / CIF) must be a valid non-negative amount.");
			return;
		}
		const requiredAmounts: Array<[keyof AssessmentFields, string]> = [
			["duty", "Customs Duty"],
			["withholding", "Withholding Tax"],
			["vat", "VAT"],
		];
		for (const [key, label] of requiredAmounts) {
			const value = assessmentFields[key].trim();
			if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) {
				setActionError(`${label} must be a valid amount greater than zero.`);
				return;
			}
		}
		if (assessmentFields.surtax.trim() && (!Number.isFinite(Number(assessmentFields.surtax)) || Number(assessmentFields.surtax) < 0)) {
			setActionError("Sur-Tax must be a valid non-negative amount.");
			return;
		}
		if (!assessmentFields.noticeNumber.trim()) {
			setActionError("Enter the Tax Assessment Notice number before submitting.");
			return;
		}
		if (!isDocumentReceived("Commercial invoice") || !isDocumentReceived("Valuation worksheet")) {
			setActionError("Please ensure required stage documents are received before submission.");
			return;
		}
		setSaving(true);
		setActionError(null);
		setActionNotice(null);
		try {
			const response = await fetch(`/api/encoder/services/${encodeURIComponent(currentServiceId)}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					assessment: {
						dutyPayingValue: Number(assessmentFields.dpv),
						customsDuty: Number(assessmentFields.duty),
						withholdingTax: Number(assessmentFields.withholding),
						vat: Number(assessmentFields.vat),
						surTax: Number(assessmentFields.surtax),
						totalTax: taxTotal,
						taxAssessmentNoticeNumber: assessmentFields.noticeNumber.trim(),
					},
				}),
			});
			const responseText = await response.text();
			let responseBody: unknown = null;
			if (responseText) {
				try {
					responseBody = JSON.parse(responseText) as unknown;
				} catch {
					responseBody = responseText;
				}
			}
			if (!response.ok) {
				throw new Error(
					typeof responseBody === "string" && responseBody.trim()
						? responseBody
						: isRecord(responseBody)
							? readText(findValue(responseBody, "message", "detail", "error", "title")) || `Submission failed (${response.status}).`
							: `Submission failed (${response.status}).`,
				);
			}
			const submittedAt = new Date().toISOString();
			const submitter = `${fullName} (Data Encoder)`;
			setRecentAssessmentSubmissionAt(submittedAt);
			setStages((current) => current.map((stage) => stage.id === selectedStage.id
				? {
					...stage,
					status: "needs_review",
					updatedAt: submittedAt,
					notes: `Assessment & Tax Payment submitted for verification by ${submitter}.`,
				}
				: stage,
			));
			setActionNotice(`Assessment submitted. Assigned Assessor (${personName(assignedAssessor) || "assessor"}) notified for verification.`);
			try {
				removeAssessmentDraft(serviceDraftKey);
			} catch (storageError: unknown) {
				setActionError(`Assessment was submitted, but the local draft could not be cleared: ${getErrorMessage(storageError)}`);
			}
		} catch (submitError: unknown) {
			setActionError(getErrorMessage(submitError));
		} finally {
			setSaving(false);
		}
	};

	const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.currentTarget.files ?? []);
		event.currentTarget.value = "";
		if (!files.length || !currentServiceId) return;
		setUploading(true);
		setActionError(null);
		setActionNotice(null);
		try {
			const formData = new FormData();
			files.forEach((file) => formData.append("files", file, file.name));
			formData.append("DocumentType", uploadRequirement || selectedStage?.name || "Supporting Document");
			const response = await fetch(`/api/encoder/services/${encodeURIComponent(currentServiceId)}/documents`, {
				method: "POST",
				body: formData,
			});
			const responseText = await response.text();
			if (!response.ok) {
				let message = responseText || `Document upload failed (${response.status}).`;
				try {
					const responseBody: unknown = JSON.parse(responseText);
					message = (isRecord(responseBody) ? readText(findValue(responseBody, "message", "detail", "error", "title")) : "") || message;
				} catch {
					// Preserve the backend response text when it is not JSON.
				}
				throw new Error(message);
			}
			setUploadRequirement("");
			setActionNotice("Document uploaded.");
			await loadService();
		} catch (uploadError: unknown) {
			setActionError(getErrorMessage(uploadError));
		} finally {
			setUploading(false);
		}
	};

	const handlePreview = async (document: ServiceDocument) => {
		const requestId = ++previewRequestIdRef.current;
		setPreviewUploadError(null);
		setPreview({ document, name: document.name, url: null, type: "", status: "loading" });
		const documentId = getDocumentId(document);
		const directUrl = readText(findValue(document, "url", "downloadUrl", "fileUrl"));
		try {
			let localCopy: StoredLocalDocument | null = null;
			if (currentServiceId) {
				try {
					localCopy = await readLocalDocument(getLocalDocumentKey(currentServiceId, document));
				} catch {
					localCopy = null;
				}
			}
			if (requestId !== previewRequestIdRef.current) return;
			if (localCopy) {
				setPreview({
					document,
					name: localCopy.name || document.name,
					url: URL.createObjectURL(localCopy.file),
					type: localCopy.type || "application/pdf",
					status: "ready",
					localOnly: !localCopy.serverSynced,
				});
				return;
			}

			let response: Response;
			if (documentId && /^[1-9]\d*$/.test(documentId) && Number.isSafeInteger(Number(documentId))) {
				response = await fetch(`/api/encoder/documents?downloadId=${encodeURIComponent(documentId)}`, {
					cache: "no-store",
				});
			} else if (directUrl) {
				response = await fetch(directUrl, { cache: "no-store" });
			} else {
				throw new Error("A document download reference is unavailable.");
			}
			if (!response.ok) throw new Error(`Document download failed (${response.status}).`);
			const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
			const blob = await response.blob();
			if (requestId !== previewRequestIdRef.current) return;
			if (!blob.size || contentType.includes("application/json")) {
				throw new Error("The document file could not be read from storage.");
			}
			const type = document.name.toLowerCase().endsWith(".pdf") && (!blob.type || blob.type === "application/octet-stream")
				? "application/pdf"
				: blob.type || contentType || "application/octet-stream";
			setPreview({
				document,
				name: document.name,
				url: URL.createObjectURL(blob),
				type,
				status: "ready",
			});
		} catch {
			if (requestId === previewRequestIdRef.current) {
				setPreview((current) => current ? { ...current, status: "missing" } : current);
			}
		}
	};

	const attachPreviewFile = async (file: File) => {
		if (!preview || !currentServiceId) return;
		if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
			setPreviewUploadError("Please choose a PDF file to attach.");
			return;
		}
		const target = preview;
		const requestId = ++previewRequestIdRef.current;
		const localKey = getLocalDocumentKey(currentServiceId, target.document);
		const objectUrl = URL.createObjectURL(file);
		let savedLocally = false;
		let serverSynced = false;
		let serverStoragePath = "";
		let serverDocumentId = "";
		let serverUploadError = "The document API upload failed.";
		setPreviewUploading(true);
		setPreviewUploadError(null);
		setActionNotice(null);
		try {
			try {
				await storeLocalDocument({
					key: localKey,
					file,
					name: file.name,
					type: "application/pdf",
					size: file.size,
					serverSynced: false,
				});
				savedLocally = true;
			} catch {
				savedLocally = false;
			}

			try {
				const documentStage = findValue(target.document, "serviceStage", "stage");
				const stageId = readText(
					findValue(target.document, "serviceStageId", "stageId", "stageExecutionId"),
					findRecordValue(documentStage, "serviceStageId", "stageId", "stageExecutionId", "id"),
					selectedStage?.id,
				);
				if (!/^[1-9]\d*$/.test(currentServiceId) || !/^[1-9]\d*$/.test(stageId)) {
					throw new Error("A server service and stage reference is unavailable.");
				}
				const formData = new FormData();
				formData.append("File", file, file.name);
				formData.append("ServiceId", currentServiceId);
				formData.append("ServiceStageId", stageId);
				formData.append("DocumentType", readText(findValue(target.document, "documentType", "type", "category")) || target.document.name);
				if (getDocumentId(target.document)) formData.append("DocumentId", getDocumentId(target.document));
				const response = await fetch("/api/encoder/documents", { method: "POST", body: formData });
				const responseText = await response.text();
				let responseBody: unknown = null;
				if (responseText) {
					try {
						responseBody = JSON.parse(responseText) as unknown;
					} catch {
						responseBody = responseText;
					}
				}
				if (!response.ok) {
					throw new Error(
						isRecord(responseBody)
							? readText(findValue(responseBody, "message", "detail", "error", "title")) || `Upload failed (${response.status}).`
							: typeof responseBody === "string" && responseBody.trim()
								? responseBody
								: `Upload failed (${response.status}).`,
					);
				}
				serverSynced = true;
				const uploadRecord = isRecord(responseBody)
					? findValue(responseBody, "data", "result", "payload")
					: undefined;
				serverStoragePath = readText(
					findRecordValue(responseBody, "storagePath", "filePath", "storageKey", "path"),
					findRecordValue(uploadRecord, "storagePath", "filePath", "storageKey", "path"),
				);
				serverDocumentId = readText(
					findRecordValue(responseBody, "documentId", "attachmentId", "id"),
					findRecordValue(uploadRecord, "documentId", "attachmentId", "id"),
				);
				if (savedLocally) {
					try {
						await storeLocalDocument({
							key: localKey,
							file,
							name: file.name,
							type: "application/pdf",
							size: file.size,
							serverSynced: true,
						});
					} catch {
						setPreviewUploadError("The document synced to server storage, but its browser cache could not be updated.");
					}
				}
			} catch (uploadError: unknown) {
				serverSynced = false;
				serverUploadError = getErrorMessage(uploadError);
			}

			if (serverSynced) {
				setDocuments((current) => current.map((document) =>
					document.id === target.document.id
						? {
							...document,
							id: serverDocumentId || document.id,
							documentIdValue: serverDocumentId || document.documentIdValue,
							name: file.name,
							fileName: file.name,
							fileSize: file.size,
							fileSizeBytes: file.size,
							...(serverStoragePath ? { storagePath: serverStoragePath } : {}),
						}
						: document,
				));
			}
			if (requestId !== previewRequestIdRef.current) {
				URL.revokeObjectURL(objectUrl);
				if (serverSynced) setActionNotice("Document file attached and synced successfully.");
				return;
			}
			setPreview({
				document: {
					...target.document,
					id: serverDocumentId || target.document.id,
					documentIdValue: serverDocumentId || target.document.documentIdValue,
					name: file.name,
					fileName: file.name,
					fileSize: file.size,
					fileSizeBytes: file.size,
					...(serverStoragePath ? { storagePath: serverStoragePath } : savedLocally ? { storagePath: `indexeddb:${localKey}` } : {}),
					localPreviewKey: localKey,
					localOnly: !serverSynced && savedLocally,
				},
				name: file.name,
				url: objectUrl,
				type: "application/pdf",
				status: "ready",
				localOnly: !serverSynced && savedLocally,
			});
			if (serverSynced) {
				setActionNotice("Document file attached and synced successfully.");
			} else if (savedLocally) {
				setPreviewUploadError(`The API upload failed: ${serverUploadError}. This file is saved in this browser only; the server document record was not changed.`);
			} else {
				setPreviewUploadError(`The API upload failed: ${serverUploadError}. The PDF is available only until this preview closes.`);
			}
		} finally {
			setPreviewUploading(false);
		}
	};

	const handleMessageOpen = () => {
		setMessageDrawerOpen(true);
		setMessageError(null);
		if (currentServiceId) {
			void fetchServiceMessages(currentServiceId);
		}
	};

	const handleSendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!currentServiceId || !importerUserId) {
			setMessageError("The importer account is not linked to a message recipient.");
			return;
		}
		if (!messageText.trim()) {
			setMessageError("Write a message before sending.");
			return;
		}
		setMessageSending(true);
		setMessageError(null);
		try {
			const result = await sendMessage({
				serviceId: currentServiceId,
				recipientId: importerUserId,
				subject: trackingNumber ? `Service ${trackingNumber}` : "Service discussion",
				content: messageText.trim(),
			});
			if (!result) {
				const storeError = useMessagingStore.getState().error;
				throw new Error(storeError || "The message could not be sent.");
			}
			setMessageText("");
			await fetchServiceMessages(currentServiceId);
		} catch (sendError: unknown) {
			setMessageError(getErrorMessage(sendError));
		} finally {
			setMessageSending(false);
		}
	};

	const renderDocuments = (list: ServiceDocument[]) => (
		<div className="divide-y divide-slate-100">
			{list.map((document) => (
				<div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
					<div className="flex min-w-0 items-center gap-3">
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
							<FileText className="h-4 w-4" />
						</span>
						<div className="min-w-0">
							<p className="truncate text-sm font-semibold text-slate-800">{document.name}</p>
							<p className="text-xs text-slate-500">
								{readText(findValue(document, "documentType", "type", "category")) || "Document"}
								{readText(findValue(document, "uploadedAt", "createdAt", "createAt")) && ` · ${formatDate(findValue(document, "uploadedAt", "createdAt", "createAt"))}`}
							</p>
						</div>
					</div>
					<button type="button" onClick={() => void handlePreview(document)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
						View / preview
					</button>
				</div>
			))}
			{!list.length && (
				<p className="py-6 text-sm text-slate-500">No service or stage documents are available in the service records.</p>
			)}
		</div>
	);

	return (
		<EncoderSectionLayout
			activeSection="services"
			title="Service details"
			description="Review service stages, documents, logistics, and importer details."
			descriptionInHeader
		>
		<div className="min-h-screen bg-slate-50 font-sans text-slate-900">
			<div className="min-h-screen">
				<div className="relative mx-auto flex max-w-[1600px] items-start gap-3 px-4 pt-4 sm:px-6 lg:px-8">
					<div className="relative min-w-0 flex-1">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
						<input
							ref={searchRef}
							value={search}
							onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }}
							onFocus={() => setSearchOpen(true)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && filteredServices[0]) selectService(filteredServices[0]);
								if (event.key === "Escape") setSearchOpen(false);
							}}
							placeholder="Search services, customers, documents..."
							aria-label="Search services, customers, and documents"
							className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-16 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
						/>
						<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</span>
						{searchOpen && search.trim() && (
							<div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-xl">
								{filteredServices.map((item, index) => (
									<button key={`${readText(findValue(item, "id", "serviceId"))}-${index}`} type="button" onClick={() => selectService(item)} className="block w-full px-4 py-3 text-left hover:bg-slate-50">
										<span className="block font-mono text-xs font-semibold text-blue-700">{readText(findPreferredValue(item, "trackingNumber", "serviceNumber", "serviceReference", "serviceCode", "referenceNumber", "id")) || "Service reference unavailable"}</span>
										<span className="mt-1 block truncate text-sm text-slate-700">{readText(findValue(item, "description", "itemDescription", "importerName", "customerName")) || "Service record"}</span>
									</button>
								))}
								{filteredDocuments.map((document) => (
									<button key={document.id} type="button" onClick={() => { setSearchOpen(false); setSearch(""); void handlePreview(document); }} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50">
										<FileText className="h-4 w-4 shrink-0 text-slate-400" />
										<span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800">{document.name}</span><span className="block text-xs text-slate-500">Document · open preview</span></span>
									</button>
								))}
								{!filteredServices.length && !filteredDocuments.length && <p className="px-4 py-3 text-sm text-slate-500">No matching services or documents in the available records.</p>}
							</div>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<div className="relative">
							<button type="button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => {
								setNotificationsOpen((open) => !open);
								if (!notificationsOpen) void fetchNotifications();
							}} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
								<Bell className="h-[18px] w-[18px]" />
								{unreadNotificationCount > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unreadNotificationCount}</span>}
							</button>
							{notificationsOpen && (
								<div className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl">
									<div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Notifications</div>
									{notificationError ? <p role="alert" className="p-4 text-sm text-rose-700">{notificationError}</p> : notifications.slice(0, 5).map((notification) => (
										<div key={notification.id} className="border-b border-slate-100 px-4 py-3 last:border-0"><p className="text-sm font-semibold">{notification.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{notification.description}</p><p className="mt-1 text-[10px] text-slate-400">{notification.category} · {notification.time}</p></div>
									))}
									{!notificationError && !notifications.length && <p className="p-4 text-sm text-slate-500">No notifications available.</p>}
								</div>
							)}
						</div>
						<div className="relative">
							<button type="button" aria-label="Help and FAQ" title="Help and FAQ" aria-expanded={helpOpen} onClick={() => setHelpOpen((open) => !open)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
								<HelpCircle className="h-[18px] w-[18px]" />
							</button>
							{helpOpen && (
								<div className="absolute right-0 top-12 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 text-slate-700 shadow-xl">
									<p className="text-sm font-semibold text-slate-900">Service workspace help</p>
									<ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600"><li>Select a workflow stage to review its service record.</li><li>Use Documents to attach, review, or preview files returned by the service.</li><li>Use Discussion to view messages or contact the linked importer account.</li></ul>
								</div>
							)}
						</div>
					</div>
				</div>

				<main className="min-w-0">
					<div className="mx-auto w-full max-w-[1720px] py-5">
						<Link href={backHref} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 transition hover:text-slate-900">
							<ArrowLeft className="h-4 w-4" /> Back to services
						</Link>

						{loading && (
							<div role="status" className="mt-5 flex min-h-64 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-600">
								<LoaderCircle className="h-5 w-5 animate-spin" /> Loading service workspace…
							</div>
						)}
						{error && !loading && (
							<div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-white p-6">
								<div className="flex items-start gap-3">
									<AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
									<div className="flex-1">
										<h1 className="font-semibold text-slate-900">Service details could not be loaded</h1>
										<p className="mt-1 text-sm text-slate-600">{error}</p>
										<button type="button" onClick={() => void loadService()} className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">Try again</button>
									</div>
								</div>
							</div>
						)}

						{service && !loading && (
							<>
								<section className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-6">
									<div className="flex flex-wrap items-start justify-between gap-4">
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
												<h1 className="font-mono font-bold text-slate-950">{trackingNumber || "Service reference unavailable"}</h1>
												{declarationReference && <span className="text-slate-400">•</span>}
												{declarationReference && <span className="font-medium text-slate-500">Internal ref {declarationReference}</span>}
											</div>
											<div className="mt-2 flex flex-wrap items-center gap-2">
												{serviceStatus && <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${serviceStatusTone}`}>{serviceStatus}</span>}
												{riskLabel && <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${riskTone}`}><ShieldCheck className="h-3 w-3" />{riskLabel.toLowerCase().includes("channel") ? riskLabel : `${riskLabel} channel`}</span>}
												<span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{workflowName}</span>
											</div>
											<h2 className="mt-3 text-lg font-bold tracking-tight text-slate-900">{title || "Service description not provided"}</h2>
											<p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
												<MapPin className="h-3.5 w-3.5 shrink-0" />
												{readText(findValue(service, "importer", "customerName", "importerName", "importerBusinessName")) || importerName}
												<span aria-hidden="true">·</span>
												{[origin, transitPort, destination].filter(Boolean).join(" → ") || "Route not provided"}
												{eta && <><span aria-hidden="true">·</span> ETA {etaLabel}</>}
											</p>
										</div>
										<div className="flex min-w-[220px] flex-col gap-2 sm:items-end">
											<div className="flex w-full justify-between text-[11px] text-slate-500 sm:w-56">
												<span>{stages.length ? `Stage ${currentStageNumber} of ${stages.length}` : "Stage progress unavailable"}</span>
												<span className="font-bold text-slate-800">{stages.length ? `${progress}% complete` : "No stage data"}</span>
											</div>
											<div className="flex w-full gap-1 sm:w-56" role="progressbar" aria-label="Service stage progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
												{stages.map((stage) => <span key={stage.id} title={`${stage.name}: ${statusLabel(stage.status)}`} className={`h-1.5 min-w-1 flex-1 rounded-full ${stage.status === "completed" ? "bg-emerald-500" : ["in_progress", "needs_review"].includes(stage.status) ? "bg-cyan-500" : "bg-slate-200"}`} />)}
												{!stages.length && <span className="h-1.5 w-full rounded-full bg-slate-200" />}
											</div>
										</div>
									</div>
								</section>

								{actionError && (
									<div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
										<span>{actionError}</span>
										{actionError.includes("Attach the original file") && (
											<button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading} className="shrink-0 rounded-md border border-rose-300 bg-white px-3 py-1.5 font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-60">
												Attach original file
											</button>
										)}
									</div>
								)}
								<input ref={uploadInputRef} type="file" multiple className="sr-only" onChange={(event) => void handleUpload(event)} disabled={uploading} />
								{actionNotice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[70] max-w-[min(420px,calc(100vw-2.5rem))] rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg">{actionNotice}</div>}

								<div className="mt-4 grid min-h-[680px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[minmax(210px,1fr)_minmax(460px,2fr)_minmax(260px,1fr)]">
									<aside className="border-b border-slate-200 bg-slate-50/80 p-3 xl:border-b-0 xl:border-r">
										<div className="flex items-center justify-between px-2 py-2">
											<h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{workflowName} workflow</h2>
											<span className="text-[10px] font-medium text-slate-400">{stages.length} stages</span>
										</div>
										{stages.length ? (
											<ol className="mt-1 max-h-[500px] space-y-1 overflow-y-auto xl:max-h-[calc(100vh-280px)]">
												{stages.map((stage, index) => {
													const isSelected = stage.id === selectedStageId;
													const isComplete = stage.status === "completed";
													return (
														<li key={stage.id}>
															<button type="button" onClick={() => { setSelectedStageId(stage.id); setActiveTab("stage"); }} aria-current={isSelected ? "step" : undefined} className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition ${isSelected ? "border border-cyan-200 bg-cyan-50" : "border border-transparent hover:bg-white"}`}>
																<span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${isComplete ? "border-emerald-200 bg-emerald-100 text-emerald-700" : isSelected ? "border-cyan-300 bg-white text-cyan-700" : "border-slate-200 bg-white text-slate-400"}`}>
																	{isComplete ? <Check className="h-3.5 w-3.5" /> : stage.status === "in_progress" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : stage.status === "needs_review" || stage.status === "blocked" ? <Clock3 className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
																</span>
																<span className="min-w-0 flex-1">
																	<span className="block text-[9px] font-semibold tracking-wide text-slate-400">{String(index + 1).padStart(2, "0")}</span>
																	<span className={`mt-0.5 block text-xs font-semibold leading-4 ${isSelected ? "text-slate-950" : "text-slate-700"}`}>{stage.name}</span>
																	<span className={`mt-1 block text-[10px] ${isComplete ? "text-emerald-700" : stage.status === "needs_review" ? "text-amber-700" : "text-slate-500"}`}>{statusLabel(stage.status)}</span>
																</span>
															</button>
														</li>
													);
												})}
											</ol>
										) : (
											<div className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500">Workflow stages are not available for this service.</div>
										)}
									</aside>

									<section className="min-w-0">
										<div className="border-b border-slate-200 px-4 pt-4 sm:px-5">
											<div className="flex flex-wrap items-center justify-between gap-3">
												<div>
													<p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Stage workspace</p>
													<h2 className="mt-1 text-sm font-bold text-slate-900">{selectedStage?.name || "Stage details unavailable"}</h2>
												</div>
												{selectedStage && <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${selectedStage.status === "needs_review" ? "bg-amber-100 text-amber-800" : selectedStage.status === "completed" ? "bg-emerald-100 text-emerald-800" : selectedStage.status === "in_progress" ? "bg-cyan-100 text-cyan-800" : "bg-slate-100 text-slate-600"}`}>{statusLabel(selectedStage.status)}</span>}
											</div>
											<div className="mt-4 flex gap-5 overflow-x-auto">
												{tabItems.map((tab) => (
													<button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? "page" : undefined} className={`whitespace-nowrap border-b-2 pb-2.5 text-[11px] font-semibold transition ${activeTab === tab.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
														{tab.label}{tab.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px]">{tab.count}</span>}
													</button>
												))}
											</div>
										</div>

										<div className="space-y-4 p-4 sm:p-5">
											{activeTab === "stage" && (
												<>
													<section className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
														<h3 className="text-[11px] font-bold text-slate-800">Previous stage summary <span className="font-normal text-slate-500">(Carried forward context)</span></h3>
														{previousStage ? (
															<p className="mt-1.5 text-xs leading-5 text-slate-600">
																<span className="font-semibold">{previousStage.name}</span> — {statusLabel(previousStage.status)}.
																{previousNotes && ` ${previousNotes}`}
																{previousInspector && ` Responsible staff: ${previousInspector}.`}
															</p>
														) : <p className="mt-1.5 text-xs text-slate-500">No previous stage record is available.</p>}
														{previousStage && (previousCompletedAt || previousDuration) && (
															<p className="mt-2 text-[10px] text-slate-500">
																{previousCompletedAt ? `Completed ${formatDate(previousCompletedAt)}` : ""}
																{previousCompletedAt && previousDuration ? " · " : ""}
																{previousDuration ? `Duration ${previousDuration}` : ""}
															</p>
														)}
													</section>

													<section className="rounded-lg border border-slate-200 p-3.5">
														<div className="flex flex-wrap items-center justify-between gap-2">
															<div>
																<h3 className="text-[11px] font-bold text-slate-800">Required documents for this stage</h3>
																<p className="mt-0.5 text-[10px] text-slate-500">
																	{requiredDocumentNames.length
																		? `${receivedRequirementCount} of ${requiredDocumentNames.length} received`
																		: `${documents.length} document${documents.length === 1 ? "" : "s"} attached to the service record`}
																</p>
															</div>
															<button type="button" onClick={() => {
																setUploadRequirement(requiredDocumentNames.find((name) =>
																	!isDocumentReceived(name),
																) || selectedStage?.name || "Supporting document");
																uploadInputRef.current?.click();
															}} disabled={uploading} className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60`}>
																{uploading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
																Attach documents
															</button>
														</div>
														{requiredDocumentNames.length ? (
															<ul className="mt-3 divide-y divide-slate-100">
																{requiredDocumentNames.map((name, index) => {
																	const received = isDocumentReceived(name);
																	return (
																		<li key={`${name}-${index}`} className="flex items-center justify-between gap-3 py-2">
																			<span className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-700">
																				<FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
																				<span className="truncate">{name}</span>
																			</span>
																			<span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${received ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
																				{received ? "Received" : "Outstanding"}
																			</span>
																		</li>
																	);
																})}
															</ul>
														) : (
															<p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[10px] text-slate-500">
																No required-document checklist is included in the service record.
															</p>
														)}
														{documentsError && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[10px] text-amber-800">{documentsError}</p>}
														<div className="mt-3 border-t border-slate-100 pt-1">
															{renderDocuments(documents.slice(0, 3))}
														</div>
													</section>

													{isAssessmentStage && (
													<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
														<div className="flex flex-wrap items-start justify-between gap-3">
															<div>
																<h3 className="text-lg font-bold text-slate-900">Assessment &amp; data entry</h3>
																<p className="mt-1 text-sm text-slate-500">Enter the recorded assessment values. Tax amounts are entered directly; no rates are assumed.</p>
															</div>
															<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">Data Encoder</span>
														</div>
														<div className="mt-5 grid gap-4 sm:grid-cols-2">
															<label className="text-xs font-semibold text-slate-700">Duty Paying Value (DPV / CIF)
																<span className="relative mt-1 block">
																	<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-slate-400">ETB</span>
																	<input inputMode="decimal" type="number" min="0" step="0.01" value={assessmentFields.dpv} onChange={(event) => updateAssessment("dpv", event.target.value)} disabled={isAssessmentLocked || selectedStage?.status !== "in_progress"} className={`${amountInputClass} pl-12`} placeholder="0.00" />
																</span>
															</label>
															<label className="text-xs font-semibold text-slate-700">Customs Duty
																<span className="relative mt-1 block">
																	<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-slate-400">ETB</span>
																	<input inputMode="decimal" type="number" min="0" step="0.01" value={assessmentFields.duty} onChange={(event) => updateAssessment("duty", event.target.value)} disabled={isAssessmentLocked || selectedStage?.status !== "in_progress"} className={`${amountInputClass} pl-12`} placeholder="0.00" />
																</span>
															</label>
															<label className="text-xs font-semibold text-slate-700">Withholding Tax
																<span className="relative mt-1 block">
																	<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-slate-400">ETB</span>
																	<input inputMode="decimal" type="number" min="0" step="0.01" value={assessmentFields.withholding} onChange={(event) => updateAssessment("withholding", event.target.value)} disabled={isAssessmentLocked || selectedStage?.status !== "in_progress"} className={`${amountInputClass} pl-12`} placeholder="0.00" />
																</span>
															</label>
															<label className="text-xs font-semibold text-slate-700">VAT
																<span className="relative mt-1 block">
																	<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-slate-400">ETB</span>
																	<input inputMode="decimal" type="number" min="0" step="0.01" value={assessmentFields.vat} onChange={(event) => updateAssessment("vat", event.target.value)} disabled={isAssessmentLocked || selectedStage?.status !== "in_progress"} className={`${amountInputClass} pl-12`} placeholder="0.00" />
																</span>
															</label>
															<label className="text-xs font-semibold text-slate-700">Sur-Tax
																<span className="relative mt-1 block">
																	<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-slate-400">ETB</span>
																	<input inputMode="decimal" type="number" min="0" step="0.01" value={assessmentFields.surtax} onChange={(event) => updateAssessment("surtax", event.target.value)} disabled={isAssessmentLocked || selectedStage?.status !== "in_progress"} className={`${amountInputClass} pl-12`} placeholder="0.00" />
																</span>
															</label>
															<label className="text-xs font-semibold text-slate-700">Tax Assessment Notice number
																<input type="text" value={assessmentFields.noticeNumber} onChange={(event) => updateAssessment("noticeNumber", event.target.value)} disabled={isAssessmentLocked || selectedStage?.status !== "in_progress"} className={amountInputClass} placeholder="AN-2026-9843" />
															</label>
														</div>
														<div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
															<span className="text-sm font-semibold text-slate-700">Total entered tax</span>
															<span className="text-lg font-bold text-slate-900">ETB {taxTotal.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
														</div>
														<div className="mt-4 flex flex-wrap justify-end gap-3">
															<button type="button" onClick={handleSaveDraft} disabled={saving || isAssessmentLocked || selectedStage?.status !== "in_progress"} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">Save draft</button>
															<button type="button" onClick={() => void handleSubmitAssessment()} disabled={saving || isAssessmentLocked || selectedStage?.status !== "in_progress"} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
																{saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
																Submit assessment for verification
															</button>
														</div>
														<p className="mt-2 text-xs leading-5 text-slate-400">Drafts are stored in this browser. Submission uses the authenticated Data Encoder service-review endpoint.</p>
													</section>
													)}
												</>
											)}

											{activeTab === "documents" && (
												<section className="rounded-lg border border-slate-200 p-4">
													<div className="flex flex-wrap items-center justify-between gap-3">
														<div><h3 className="text-sm font-bold text-slate-900">Service documents</h3><p className="mt-1 text-xs text-slate-500">Documents attached to the service and its stages.</p></div>
														<button type="button" onClick={() => {
															setUploadRequirement(requiredDocumentNames.find((name) =>
																!isDocumentReceived(name),
															) || selectedStage?.name || "Supporting document");
															uploadInputRef.current?.click();
														}} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
															<Upload className="h-4 w-4" />{uploading ? "Uploading…" : "Upload documents"}
														</button>
													</div>
													{documentsError && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{documentsError}</p>}
													{renderDocuments(documents)}
												</section>
											)}

											{activeTab === "discussion" && (
												<section className="rounded-lg border border-slate-200 p-4">
													<div className="flex flex-wrap items-center justify-between gap-2">
														<div><h3 className="text-sm font-bold text-slate-900">Service discussion</h3><p className="mt-1 text-xs text-slate-500">Messages associated with this service.</p></div>
														<button type="button" onClick={() => void fetchServiceMessages(currentServiceId)} className="text-xs font-semibold text-blue-700 hover:text-blue-900">Refresh</button>
													</div>
													{messagingError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{messagingError}</p>}
													<div className="mt-4 space-y-3">
														{displayMessages.map((message: UserMessage, index) => {
															const sender = personName(message.senderUser) || (String(message.senderUserId ?? message.senderId) === String(user?.id) ? fullName : importerName);
															return <article key={String(message.id ?? index)} className="rounded-lg bg-slate-50 p-3">
																<div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{sender}</p><time className="text-[10px] text-slate-400">{formatDate(message.createdDate ?? message.createAt)}</time></div>
																{message.subject && <p className="mt-1 text-[10px] font-semibold text-slate-600">{message.subject}</p>}
																<p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{message.content || "Message content unavailable."}</p>
															</article>;
														})}
														{!displayMessages.length && !messagingError && <p className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No discussion messages were returned for this service.</p>}
													</div>
													<form onSubmit={(event) => void handleSendMessage(event)} className="mt-4 border-t border-slate-100 pt-4">
														<label htmlFor="service-message" className="text-xs font-semibold text-slate-700">Message importer</label>
														<textarea id="service-message" rows={3} value={messageText} onChange={(event) => setMessageText(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="Write a service-related message…" />
														{messageError && <p role="alert" className="mt-2 text-xs text-rose-700">{messageError}</p>}
														<div className="mt-2 flex justify-end"><button type="submit" disabled={messageSending || !importerUserId} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{messageSending ? "Sending…" : "Send message"}</button></div>
														{!importerUserId && <p className="mt-2 text-[10px] text-amber-700">A linked importer user account is required to send a message.</p>}
													</form>
												</section>
											)}

											{activeTab === "consignment" && (
												<section className="rounded-lg border border-slate-200 p-4">
													<div className="flex items-center gap-2"><Ship className="h-4 w-4 text-slate-500" /><h3 className="text-sm font-bold text-slate-900">Consignment details</h3></div>
													<div className="mt-4 grid gap-4 sm:grid-cols-2">
														{[
															["Goods description", title],
															["Origin", origin],
															["Transit port", transitPort],
															["Destination", destination],
															["Route category", readText(findValue(service, "routeCategory", "route"))],
															["Vessel / voyage", [vessel, voyage].filter(Boolean).join(" / ")],
															["Flight / airway bill", [flightNumber, readText(findValue(service, "consignmentNumber"))].filter(Boolean).join(" / ")],
															["Container numbers", readText(findValue(service, "containerNumbers", "containers"))],
															["Seal numbers", readText(findValue(service, "sealNumbers", "seals"))],
															["Net / gross weight", readText(findValue(service, "consignmentWeight", "weight"))],
															["Temperature log", readText(findValue(service, "temperatureLog", "temperature"))],
															["Estimated arrival", eta ? formatDate(eta) : ""],
															["Country of origin", readText(findValue(service, "countryOfOrigin", "originCountry"))],
															["Declared value", readText(findValue(service, "declaredValue", "value", "invoiceValue"))],
														].map(([label, value]) => <div key={label} className="border-b border-slate-100 pb-3"><p className="text-[10px] font-semibold text-slate-400">{label}</p><p className="mt-1 text-xs font-medium text-slate-800">{value || "Not provided in service record"}</p></div>)}
													</div>
												</section>
											)}
										</div>
									</section>

									<aside className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-3.5 xl:border-l xl:border-t-0">
										<section className="rounded-lg border border-slate-200 bg-white p-3.5">
											<div className="flex items-center justify-between gap-2">
												<h3 className="text-[11px] font-bold text-slate-800">Importer</h3>
												<button type="button" onClick={handleMessageOpen} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[9px] font-semibold text-slate-600 hover:bg-slate-50"><MessageSquare className="h-3 w-3" />Message</button>
											</div>
											<div className="mt-3 flex items-start gap-2.5">
												<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-700">{initials(importerName)}</span>
												<div className="min-w-0"><p className="text-xs font-bold text-slate-900">{importerName}</p><p className="mt-0.5 text-[10px] text-slate-500">{importerCode ? `Code: ${importerCode}` : "Customer code not provided"}{importerTin ? ` · TIN: ${importerTin}` : ""}</p></div>
											</div>
											<div className="mt-3 space-y-1 text-[10px] text-slate-600">
												{contactName && <p>Contact: <span className="font-medium text-slate-800">{contactName}</span></p>}
												{contactPhone && <p>Phone: <span className="font-medium text-slate-800">{contactPhone}</span></p>}
												{!contactName && !contactPhone && <p>Contact information is not present in this service record.</p>}
											</div>
										</section>

										<section className="rounded-lg border border-slate-200 bg-white p-3.5">
											<h3 className="text-[11px] font-bold text-slate-800">Assigned staff</h3>
											{[
												{ label: "Case executor", value: assignedExecutor },
												{ label: "Valuation & compliance assessor", value: assignedAssessor },
											].map(({ label, value }) => <div key={label} className="mt-3 flex items-center gap-2.5">
												<span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{initials(personName(value))}</span>
												<div><p className="text-[9px] text-slate-400">{label}</p><p className="text-xs font-semibold text-slate-800">{personName(value) || "Not assigned"}</p></div>
											</div>)}
										</section>

										<section className="rounded-lg border border-slate-200 bg-white p-3.5">
											<h3 className="text-[11px] font-bold text-slate-800">Risk &amp; compliance</h3>
											{riskLabel ? <div className={`mt-2 rounded-lg border p-2.5 ${riskTone}`}>
												<p className="flex items-center gap-1.5 text-[10px] font-bold"><ShieldCheck className="h-3.5 w-3.5" />{riskLabel.toLowerCase().includes("channel") ? riskLabel : `${riskLabel} channel`}</p>
												<p className="mt-1 text-[10px] leading-4">{riskGuidance}</p>
											</div> : <p className="mt-2 text-[10px] text-slate-500">Risk channel is not included in the service record.</p>}
										</section>

										<section className="rounded-lg border border-slate-200 bg-white p-3.5">
											<h3 className="text-[11px] font-bold text-slate-800">Recent activity</h3>
											{activities.length ? <ol className="mt-3 space-y-3">
												{activities.map((activity) => {
													const isAssessmentSubmission = activity.note.startsWith("Assessment & Tax Payment submitted for verification by ");
													const isRecent = isAssessmentSubmission && recentAssessmentSubmissionAt === readText(activity.date);
													return <li key={activity.id} className="relative flex gap-2.5">
														<span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Clock3 className="h-3 w-3" /></span>
														<div className="min-w-0">
															<p className="text-[10px] font-semibold leading-4 text-slate-700">
																{isAssessmentSubmission
																	? `${activity.note.replace(/\.$/, "")} · ${isRecent ? "Just now" : formatDate(activity.date)}`
																	: `${activity.name} — ${activity.status}`}
															</p>
															{activity.note && !isAssessmentSubmission && <p className="mt-0.5 line-clamp-2 text-[9px] text-slate-500">{activity.note}</p>}
															{!isAssessmentSubmission && <p className="mt-0.5 text-[9px] text-slate-400">{formatDate(activity.date)}</p>}
														</div>
													</li>;
												})}
											</ol> : <p className="mt-2 text-[10px] text-slate-500">No dated activity records are available.</p>}
										</section>

										<section className="rounded-lg border border-slate-200 bg-white p-3.5">
											<h3 className="text-[11px] font-bold text-slate-800">Logistics</h3>
											<div className="mt-2 flex gap-2">{flightNumber || carrier ? <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> : <Ship className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}<div><p className="text-[9px] text-slate-400">{flightNumber || carrier ? "Flight / carrier" : "Vessel / voyage"}</p><p className="mt-0.5 text-[10px] font-medium text-slate-700">{[flightNumber, carrier].filter(Boolean).join(" — ") || [vessel, voyage].filter(Boolean).join(" / ") || "Not provided in service record"}</p></div></div>
											<div className="mt-2 flex gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><div><p className="text-[9px] text-slate-400">Transit route</p><p className="mt-0.5 text-[10px] font-medium text-slate-700">{[origin, transitPort, destination].filter(Boolean).join(" → ") || "Not provided in service record"}</p></div></div>
										</section>
									</aside>
								</div>
							</>
						)}
					</div>
				</main>
			</div>

			{messageDrawerOpen && (
				<div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35">
					<button type="button" aria-label="Close message panel" onClick={() => setMessageDrawerOpen(false)} className="absolute inset-0 cursor-default" />
					<aside role="dialog" aria-modal="true" aria-label="Message importer" className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
						<div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
							<div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Service discussion</p><h2 className="mt-1 text-base font-bold text-slate-900">{importerName}</h2></div>
							<button type="button" aria-label="Close" onClick={() => setMessageDrawerOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
						</div>
						<div className="flex-1 space-y-3 overflow-y-auto p-4">
							{displayMessages.map((message: UserMessage, index) => <article key={String(message.id ?? index)} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
								<p className="text-[10px] font-semibold text-slate-700">{personName(message.senderUser) || importerName} <span className="ml-1 font-normal text-slate-400">{formatDate(message.createdDate ?? message.createAt)}</span></p>
								<p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{message.content || "Message content unavailable."}</p>
							</article>)}
							{!displayMessages.length && <p className="py-8 text-center text-xs text-slate-500">{messagingError || "No discussion messages are available."}</p>}
						</div>
						<form onSubmit={(event) => void handleSendMessage(event)} className="border-t border-slate-200 p-4">
							<textarea rows={3} value={messageText} onChange={(event) => setMessageText(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="Write a message…" />
							{messageError && <p role="alert" className="mt-2 text-xs text-rose-700">{messageError}</p>}
							<div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-400">{importerUserId ? `To: ${importerName}` : "No importer messaging account linked"}</span><button type="submit" disabled={messageSending || !importerUserId} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{messageSending ? "Sending…" : "Send message"}</button></div>
						</form>
					</aside>
				</div>
			)}

			{preview && (
				<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
					<section role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`} className="flex h-[min(85vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
						<header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
							<h2 className="truncate text-sm font-semibold text-slate-800">{preview.name}</h2>
							<button type="button" onClick={() => { previewRequestIdRef.current += 1; setPreview(null); }} aria-label="Close preview" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
						</header>
						<div className="flex-1 overflow-auto bg-slate-100">
							<input
								ref={previewUploadRef}
								type="file"
								accept="application/pdf,.pdf"
								className="sr-only"
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = "";
									if (file) void attachPreviewFile(file);
								}}
							/>
							{preview.status === "loading" && (
								<div className="flex h-full min-h-64 items-center justify-center gap-3 text-sm text-slate-600">
									<LoaderCircle className="h-5 w-5 animate-spin text-blue-700" />
									Loading document preview…
								</div>
							)}
							{preview.status === "ready" && preview.url && (
								<div className="flex h-full min-h-64 flex-col">
									{previewUploadError && (
										<div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{previewUploadError}</div>
									)}
									{preview.localOnly && (
										<div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<span>This document is currently available from this browser&apos;s local storage.</span>
												<button type="button" onClick={() => previewUploadRef.current?.click()} disabled={previewUploading} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60">
													Re-attach PDF to sync
												</button>
											</div>
										</div>
									)}
									{preview.type.startsWith("image/") ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={preview.url} alt={preview.name} className="h-full w-full flex-1 object-contain" />
									) : preview.type === "application/pdf" || preview.type.startsWith("text/") ? (
										<iframe title={preview.name} src={preview.url} className="h-full min-h-64 flex-1 bg-white" />
									) : (
										<div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-600">
											<FileText className="h-10 w-10 text-slate-400" />
											<p>This file type cannot be previewed here.</p>
											<a href={preview.url} download={preview.name} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Download document</a>
										</div>
									)}
								</div>
							)}
							{preview.status === "missing" && (
								<div className="flex min-h-full flex-col items-center justify-center gap-5 p-5 sm:p-8">
									<div role="alert" className="flex w-full max-w-2xl items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
										<AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
										<p>Document file not found in storage. Attach the original PDF to restore access.</p>
									</div>
									<button
										type="button"
										onClick={() => previewUploadRef.current?.click()}
										onDragOver={(event) => event.preventDefault()}
										onDrop={(event) => {
											event.preventDefault();
											const file = event.dataTransfer.files[0];
											if (file) void attachPreviewFile(file);
										}}
										disabled={previewUploading}
										className="flex min-h-48 w-full max-w-2xl flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-600 transition hover:border-blue-400 hover:bg-blue-50/40 disabled:cursor-wait disabled:opacity-70"
									>
										{previewUploading ? <LoaderCircle className="h-7 w-7 animate-spin text-blue-700" /> : <Upload className="h-7 w-7 text-slate-400" />}
										<span className="font-semibold text-slate-800">{previewUploading ? "Attaching document…" : "Click or drag PDF here to attach file"}</span>
										<span className="text-xs text-slate-500">PDF files only · The upload is sent to the configured document API.</span>
									</button>
									<div className="flex flex-wrap items-center justify-center gap-3">
										<button type="button" onClick={() => previewUploadRef.current?.click()} disabled={previewUploading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
											Choose PDF
										</button>
									</div>
									{previewUploadError && <p role="status" className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{previewUploadError}</p>}
								</div>
							)}
						</div>
					</section>
				</div>
			)}
		</div>
		</EncoderSectionLayout>
	);
}
