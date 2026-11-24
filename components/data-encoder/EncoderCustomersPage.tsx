"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
	Building2,
	Clock3,
	Plus,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldCheck,
	X,
} from "lucide-react";

import EncoderSectionLayout from "@/components/data-encoder/EncoderSectionLayout";
import {
	DataEncoderEndpoints,
	normalizeCustomerCreatePayload,
	type CustomerAccountOption,
} from "@/modules/dataencoder/data-encoder.endpoint";
import useAuthStore from "@/modules/auth/auth.store";
import { useRolesStore } from "@/modules/roles/roles.store";

type CustomerRow = {
	id: string;
	businessName: string;
	tinNumber: string;
	businessLicense: string;
	businessType: string;
	contactPerson: string;
	contactPhone: string;
	contactEmail: string;
	registeredAt: string;
	activeCases: number | null;
	kycStatus: "Verified" | "Pending" | "Revision";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readText = (value: unknown): string =>
	typeof value === "string" || typeof value === "number"
		? String(value)
		: "";

const findValue = (
	record: Record<string, unknown>,
	...names: string[]
): unknown => {
	const key = Object.keys(record).find((candidate) =>
		names.some(
			(name) => name.toLowerCase() === candidate.toLowerCase(),
		),
	);

	return key ? record[key] : undefined;
};

const readRelatedValue = (
	value: unknown,
	...names: string[]
): unknown => {
	if (!isRecord(value)) return value;
	return findValue(value, ...names, "id", "customerId", "name", "businessName");
};

const unwrapRows = (
	value: unknown,
	listNames: string[] = ["items", "customers", "records", "rows"],
): Record<string, unknown>[] => {
	let current = value;
	const listKeys = new Set(listNames.map((name) => name.toLowerCase()));

	for (let depth = 0; depth < 6; depth += 1) {
		if (Array.isArray(current)) {
			if (!current.every(isRecord)) {
				throw new Error(
					"The backend returned an invalid customer list.",
				);
			}

			return current;
		}

		if (!isRecord(current)) {
			break;
		}

		const key = Object.keys(current).find((name) =>
			[
				"data",
				"payload",
				"response",
				"items",
				"customers",
				"services",
				"records",
				"result",
				"rows",
				"servicelist",
			].some((candidate) =>
				candidate.toLowerCase() === name.toLowerCase() &&
				(listKeys.has(name.toLowerCase()) ||
					["data", "payload", "response", "result"].includes(name.toLowerCase())),
			),
		);

		if (!key) {
			break;
		}

		current = current[key];
	}

	throw new Error(
		"The backend response did not contain a customer list.",
	);
};

const getResponseError = (
	body: unknown,
	fallback: string,
): string => {
	if (!isRecord(body)) {
		return typeof body === "string" && body.trim()
			? body
			: fallback;
	}

	const messages = ["message", "detail", "error", "title"]
		.flatMap((key) => {
			const value = body[key];
			return typeof value === "string" && value.trim() ? [value.trim()] : [];
		});
	const errors = body.errors;
	if (Array.isArray(errors)) {
		messages.push(
			...errors.flatMap((value) =>
				typeof value === "string" && value.trim() ? [value.trim()] : [],
			),
		);
	} else if (isRecord(errors)) {
		for (const [field, value] of Object.entries(errors)) {
			const details = Array.isArray(value) ? value : [value];
			for (const detail of details) {
				if (typeof detail === "string" && detail.trim()) {
					messages.push(`${field}: ${detail.trim()}`);
				}
			}
		}
	}

	return [...new Set(messages)].join("; ") || fallback;
};

const readCreatedUserId = (value: unknown, depth = 0): string | null => {
	if (depth > 8) return null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const id = readCreatedUserId(item, depth + 1);
			if (id) return id;
		}
		return null;
	}
	if (typeof value === "number" || typeof value === "string") {
		const normalizedId = String(value).trim();
		return /^[1-9]\d*$/.test(normalizedId) &&
			Number.isSafeInteger(Number(normalizedId))
			? normalizedId
			: null;
	}
	if (!isRecord(value)) return null;

	const id = readCreatedUserId(findValue(value, "userId", "id"), depth + 1);
	if (id) return id;

	for (const key of ["data", "payload", "response", "result", "user", "account", "items", "users"]) {
		const nested = findValue(value, key);
		if (nested === undefined || nested === value) continue;
		const nestedId = readCreatedUserId(nested, depth + 1);
		if (nestedId) return nestedId;
	}
	return null;
};

const readCreatedCustomerId = (value: unknown, depth = 0): string | null => {
	if (depth > 8 || !isRecord(value)) return null;
	for (const key of ["customerId", "id"]) {
		const candidate = findValue(value, key);
		const normalized =
			typeof candidate === "number" || typeof candidate === "string"
				? String(candidate).trim()
				: "";
		if (/^[1-9]\d*$/.test(normalized) && Number.isSafeInteger(Number(normalized))) {
			return normalized;
		}
	}
	for (const key of ["data", "payload", "response", "result", "customer", "record"]) {
		const nested = findValue(value, key);
		const id = readCreatedCustomerId(nested, depth + 1);
		if (id) return id;
	}
	return null;
};

const readResponseBody = async (response: Response): Promise<unknown> => {
	if (response.status === 204) return null;
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
};

const readCustomerId = (record: Record<string, unknown>): string =>
	readText(readRelatedValue(
		findValue(record, "customerId", "importerId", "customer", "importer"),
		"id",
		"customerId",
		"businessName",
	)) || readText(findValue(record, "customerId", "importerId"));

const readCustomerName = (record: Record<string, unknown>): string =>
	readText(
		readRelatedValue(
			findValue(record, "customer", "importer"),
			"businessName",
			"companyName",
			"name",
		),
	) || readText(findValue(record, "customerName", "importerName", "businessName"));

const readCustomerTin = (record: Record<string, unknown>): string =>
	readText(
		readRelatedValue(
			findValue(record, "customer", "importer"),
			"tinNumber",
			"tin",
		),
	) || readText(findValue(record, "customerTin", "importerTin", "tinNumber", "tin"));

const getKycStatus = (record: Record<string, unknown>): CustomerRow["kycStatus"] => {
	const status = readText(findValue(
		record,
		"kycStatus",
		"verificationStatus",
		"approvalStatus",
		"approvalState",
		"recordStatus",
		"status",
	)).toLowerCase();
	if (status.includes("revision") || status.includes("rejected") || status.includes("correction")) {
		return "Revision";
	}
	if (status.includes("verified") || status.includes("approved")) {
		return "Verified";
	}

	const verified = findValue(record, "isVerified", "verified", "isApproved", "approved");
	if (verified === true || verified === 1 || verified === "1" ||
		(typeof verified === "string" && verified.toLowerCase() === "true")) {
		return "Verified";
	}
	if (verified === false || verified === 0 || verified === "0" ||
		(typeof verified === "string" && verified.toLowerCase() === "false")) {
		return "Pending";
	}
	return "Pending";
};

const readCaseCount = (record: Record<string, unknown>): number | null => {
	const value = findValue(
		record,
		"activeCases",
		"activeCaseCount",
		"activeServiceCount",
		"serviceCount",
		"caseCount",
		"totalServices",
	);
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.floor(value);
	}
	if (typeof value === "string" && value.trim()) {
		const count = Number(value);
		if (Number.isFinite(count) && count >= 0) return Math.floor(count);
	}
	return null;
};

const readCategory = (service: Record<string, unknown>): string => {
	const value = findValue(service, "serviceType", "mode", "transportMode");
	if (value === 0 || value === "0") return "Multimodal";
	if (value === 1 || value === "1") return "Unimodal";
	return readText(value);
};

const isActiveService = (service: Record<string, unknown>): boolean => {
	const status = readText(findValue(
		service,
		"status",
		"serviceStatus",
		"approvalStatus",
		"recordStatus",
	)).toLowerCase();
	return !["complete", "closed", "cancel", "reject", "archive"].some((term) =>
		status.includes(term),
	);
};

interface EncoderCustomersPageProps {
	createPage?: boolean;
}

export default function EncoderCustomersPage({
	createPage = false,
}: EncoderCustomersPageProps) {
	const pathname = usePathname();
	const router = useRouter();
	const customerFormRef = useRef<HTMLFormElement>(null);
	const roles = useRolesStore((state) => state.roles);
	const fetchRoles = useRolesStore((state) => state.fetchRoles);
	const [customers, setCustomers] = useState<CustomerRow[]>([]);
	const [customerAccounts, setCustomerAccounts] = useState<CustomerAccountOption[]>([]);
	const [customerAccountsLoading, setCustomerAccountsLoading] = useState(createPage);
	const [customerAccountsError, setCustomerAccountsError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [serviceDataError, setServiceDataError] = useState<string | null>(null);

	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [accountCreateOpen, setAccountCreateOpen] = useState(false);
	const [accountCreating, setAccountCreating] = useState(false);
	const [accountCreateError, setAccountCreateError] = useState<string | null>(null);
	const [accountFieldErrors, setAccountFieldErrors] = useState<Record<string, string>>({});
	const [selectedAccountId, setSelectedAccountId] = useState("");
	const selectedAccountIsAvailable = customerAccounts.some(
		(account) => account.id === selectedAccountId,
	);
	const [newAccount, setNewAccount] = useState({
		firstName: "",
		lastName: "",
		username: "",
		password: "",
		email: "",
		phone: "",
	});
	const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const [createOpen, setCreateOpen] = useState(createPage);
	const [search, setSearch] = useState("");

	const closeCreate = useCallback(() => {
		setCreateOpen(false);
		if (createPage) router.replace(pathname.replace(/\/new\/?$/, ""));
	}, [createPage, pathname, router]);

	const redirectToLogin = useCallback(async () => {
		try {
			await useAuthStore.getState().logout();
		} catch {
			// Ignore logout failures and continue to the login screen.
		}

		const localeSegment = window.location.pathname.split("/")[1];
		const locale = localeSegment === "am" || localeSegment === "en" ? localeSegment : "en";
		const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
		router.replace(`/${locale}/auth/login?callbackUrl=${callbackUrl}`);
	}, [router]);

	const loadCustomerAccounts = useCallback(async (): Promise<CustomerAccountOption[]> => {
		try {
			const accounts = await DataEncoderEndpoints.getActiveCustomerAccounts();
			setCustomerAccounts(accounts);
			if (accounts.length === 0) setAccountCreateOpen(true);
			return accounts;
		} catch (accountsError: unknown) {
			setCustomerAccounts([]);
			setAccountCreateOpen(true);
			setCustomerAccountsError(
				accountsError instanceof Error
					? accountsError.message
					: "Unable to load active customer accounts.",
			);
			return [];
		} finally {
			setCustomerAccountsLoading(false);
		}
	}, []);

	const createCustomerAccount = async () => {
		setAccountCreateError(null);
		setAccountFieldErrors({});
		const accountErrors: Record<string, string> = {};
		if (newAccount.firstName.trim().length < 2) accountErrors.firstName = "Enter a first name with at least 2 characters.";
		if (newAccount.lastName.trim().length < 2) accountErrors.lastName = "Enter a last name with at least 2 characters.";
		if (newAccount.username.trim().length < 3) accountErrors.username = "Enter a username with at least 3 characters.";
		if (newAccount.password.length < 8) accountErrors.password = "Password must be at least 8 characters.";
		const contactEmail = newAccount.email.trim();
		const contactPhone = newAccount.phone.trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
			accountErrors.email = "Enter a valid email address.";
		}
		if (!contactPhone) accountErrors.phone = "Enter a contact phone number.";
		if (!profilePhoto) accountErrors.profilePhoto = "Choose a profile photo.";
		else if (!["image/jpeg", "image/png", "image/webp"].includes(profilePhoto.type)) {
			accountErrors.profilePhoto = "Choose a JPG, PNG, or WEBP image.";
		} else if (profilePhoto.size > 5 * 1024 * 1024) {
			accountErrors.profilePhoto = "The image must be 5 MB or smaller.";
		}
		if (Object.keys(accountErrors).length) {
			setAccountFieldErrors(accountErrors);
			return;
		}

		const customerRole = roles.find((role) => role.roleName.trim().toLowerCase() === "importer")
			?? roles.find((role) => role.roleName.trim().toLowerCase() === "customer");
		if (!customerRole?.id) {
			setAccountCreateError("The Customer or Importer role is unavailable. Refresh roles and try again.");
			return;
		}

		const payload = new FormData();
		payload.set("Username", newAccount.username.trim());
		payload.set("FirstName", newAccount.firstName.trim());
		payload.set("LastName", newAccount.lastName.trim());
		payload.set("Email", contactEmail);
		payload.set("Phone", contactPhone);
		payload.set("Password", newAccount.password);
		payload.set("IsSuperAdmin", "false");
		payload.set("Roles", String(customerRole.id));
		if (profilePhoto) payload.set("ProfileFile", profilePhoto, profilePhoto.name);

		setAccountCreating(true);
		try {
			const response = await DataEncoderEndpoints.createCustomerAccount(payload);
			const body = await readResponseBody(response);
			if (response.status === 401 || response.status === 403) {
				await redirectToLogin();
				return;
			}
			if (!response.ok || (isRecord(body) && (body.error === true || body.isError === true))) {
				throw new Error(getResponseError(body, `User creation failed (${response.status}).`));
			}

			const createdUserId = readCreatedUserId(body);
			const accounts = await loadCustomerAccounts();
			const createdAccount =
				accounts.find((account) => account.email?.toLowerCase() === contactEmail.toLowerCase()) ??
				(createdUserId
					? {
							id: createdUserId,
							label: `${newAccount.firstName.trim()} ${newAccount.lastName.trim()} · ${contactEmail}`,
							email: contactEmail,
						}
					: undefined);
			if (createdAccount) {
				const form = customerFormRef.current;
				if (form) {
					const contactValues: Record<string, string> = {
						contactPerson: `${newAccount.firstName.trim()} ${newAccount.lastName.trim()}`,
						contactPhone,
						contactEmail,
					};
					for (const [name, value] of Object.entries(contactValues)) {
						const field = form.elements.namedItem(name);
						if (field instanceof HTMLInputElement) field.value = value;
					}
				}
				setCustomerAccounts((current) =>
					current.some((account) => account.id === createdAccount.id)
						? current
						: [...current, createdAccount],
				);
				setSelectedAccountId(createdAccount.id);
				setAccountCreateOpen(false);
				setAccountCreateError(null);
				setNewAccount({
					firstName: "",
					lastName: "",
					username: "",
					password: "",
					email: "",
					phone: "",
				});
				setProfilePhoto(null);
			} else {
				setAccountCreateError("Account creation succeeded, but no user ID was returned and the account is not in the active Customer/Importer list. Refresh the list before creating the customer profile.");
			}
		} catch (createError: unknown) {
			setAccountCreateError(
				createError instanceof Error ? createError.message : "Unable to create the customer account.",
			);
		} finally {
			setAccountCreating(false);
		}
	};

	useEffect(() => {
		if (!accountCreateOpen || roles.length) return;
		void fetchRoles().catch((roleError: unknown) => {
			setAccountCreateError(
				roleError instanceof Error ? roleError.message : "Unable to load Customer/Importer roles.",
			);
		});
	}, [accountCreateOpen, fetchRoles, roles.length]);

	const loadCustomers = useCallback(async (): Promise<boolean> => {
		setLoading(true);
		setError(null);
		setServiceDataError(null);

		try {
			const [response, servicesResponse] = await Promise.all([
				DataEncoderEndpoints.getCustomerRegistry("1"),
				fetch("/api/encoder/services", { cache: "no-store" }).catch(() => null),
			]);
			const body: unknown = response.status === 204 ? [] : await response.json();
			if (response.status === 401 || response.status === 403) {
				await redirectToLogin();
				return false;
			}
			if (
				!response.ok ||
				(isRecord(body) &&
					(body.error === true ||
						body.isError === true ||
						(typeof body.statusCode === "number" && body.statusCode >= 400)))
			) {
				throw new Error(getResponseError(body, `Customer list failed (${response.status}).`));
			}

			const rows = unwrapRows(body);
			let services: Record<string, unknown>[] = [];
			let servicesLoaded = false;
			if (servicesResponse) {
				try {
					const servicesBody: unknown =
						servicesResponse.status === 204 ? [] : await servicesResponse.json();
					if (
						!servicesResponse.ok ||
						(isRecord(servicesBody) &&
							(servicesBody.error === true ||
								servicesBody.isError === true ||
								(typeof servicesBody.statusCode === "number" &&
									servicesBody.statusCode >= 400)))
					) {
						throw new Error(
							getResponseError(servicesBody, `Service list failed (${servicesResponse.status}).`),
						);
					}
					services = unwrapRows(servicesBody, ["services", "items", "records", "rows", "serviceList"]);
					servicesLoaded = true;
				} catch (serviceError: unknown) {
					setServiceDataError(
						serviceError instanceof Error
							? serviceError.message
							: "Unable to load service activity for customers.",
					);
				}
			} else {
				setServiceDataError("Unable to reach the service list to load customer case counts.");
			}

			const servicesByCustomer = new Map<string, Record<string, unknown>[]>();
			for (const service of services) {
				const customerId = readCustomerId(service);
				const customerName = readCustomerName(service).toLowerCase();
				const customerTin = readCustomerTin(service).toLowerCase();
				const customerKey = customerId
					? `id:${customerId}`
					: customerTin
						? `tin:${customerTin}`
						: customerName
							? `name:${customerName}`
							: "";
				if (!customerKey) continue;
				const customerServices = servicesByCustomer.get(customerKey) ?? [];
				customerServices.push(service);
				servicesByCustomer.set(customerKey, customerServices);
			}

			setCustomers(
				rows.map((record, index) => {
					const id = readText(findValue(record, "id", "customerId")) || `customer-${index + 1}`;
					const businessName = readText(findValue(record, "businessName", "companyName", "importerName"));
					const tinNumber = readText(findValue(record, "tinNumber", "tin", "taxIdentificationNumber"));
					const servicesForCustomer =
						servicesByCustomer.get(`id:${id}`) ??
						servicesByCustomer.get(`tin:${tinNumber.toLowerCase()}`) ??
						servicesByCustomer.get(`name:${businessName.toLowerCase()}`) ??
						[];
					const explicitCaseCount = readCaseCount(record);
					const verificationNotes = readText(findValue(record, "verificationNotes", "revisionNotes"));

					return {
						id,
						businessName,
						tinNumber,
						businessLicense: readText(findValue(record, "businessLicense", "licenseNumber")),
						businessType: readText(findValue(record, "businessType", "category", "customerCategory")) ||
							readCategory(servicesForCustomer[0] ?? {}),
						contactPerson: readText(findValue(record, "contactPerson", "fullName")),
						contactPhone: readText(findValue(record, "contactPhone", "phone")),
						contactEmail: readText(findValue(record, "contactEmail", "email")),
						registeredAt: readText(findValue(
							record,
							"createdAt",
							"createAt",
							"registeredAt",
							"registrationDate",
							"createdDate",
						)),
						activeCases: explicitCaseCount ??
							(servicesLoaded ? servicesForCustomer.filter(isActiveService).length : null),
						kycStatus: verificationNotes ? "Revision" : getKycStatus(record),
					};
				}),
			);
			return true;
		} catch (loadError: unknown) {
			setCustomers([]);
			setError(loadError instanceof Error ? loadError.message : "Unable to load customers.");
			return false;
		} finally {
			setLoading(false);
		}
	}, [redirectToLogin]);

	/**
	 * POST
	 * /api/v1/DataEncoder/CreateCustomer
	 */
	const createCustomer = async (
		event: FormEvent<HTMLFormElement>,
	) => {
		event.preventDefault();

		setSubmitError(null);
		setFieldErrors({});
		setSuccess(null);
		setSubmitting(true);

		const form = event.currentTarget;

		if (!selectedAccountIsAvailable) {
			setFieldErrors({
				userId: "Select or create an active Customer/Importer account before creating this customer.",
			});
			setSubmitting(false);
			return;
		}

		const formData = new FormData(form);

		let payload: Record<string, unknown>;
		try {
			payload = normalizeCustomerCreatePayload(
				Object.fromEntries(formData.entries()),
			);
		} catch (payloadError: unknown) {
			setSubmitError(
				payloadError instanceof Error
					? payloadError.message
					: "Select a valid active customer account.",
			);
			setSubmitting(false);
			return;
		}

		const invalidFields = Array.from(
			form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
				"input, select, textarea",
			),
		).filter((field) => field.willValidate && !field.checkValidity());
		if (invalidFields.length) {
			const errors = Object.fromEntries(
				invalidFields.map((field) => [field.name, field.validationMessage]),
			);
			console.warn("Customer form validation failed:", errors);
			setFieldErrors(errors);
			invalidFields[0]?.focus();
			setSubmitting(false);
			return;
		}

		/*
		 * The expiry field is optional.
		 * If the user leaves it empty, send null instead of "".
		 */
		const expiry = payload.importLicenseExpiry;
		if (typeof expiry === "string" && expiry.trim()) {
			const expiryDate = new Date(expiry);
			if (Number.isNaN(expiryDate.getTime())) {
				const dateError = "Enter a valid import license expiry date.";
				console.warn("Customer form validation failed:", { importLicenseExpiry: dateError });
				setFieldErrors({ importLicenseExpiry: dateError });
				setSubmitting(false);
				return;
			}
			payload.importLicenseExpiry = expiryDate.toISOString();
		} else {
			payload.importLicenseExpiry = null;
		}
		for (const [key, value] of Object.entries(payload)) {
			if (value === "") payload[key] = null;
		}

		try {
			const response = await DataEncoderEndpoints.createCustomer(payload);
			const body = await readResponseBody(response);
			if (response.status === 401 || response.status === 403) {
				await redirectToLogin();
				return;
			}
			if (
				!response.ok ||
				(isRecord(body) &&
					(body.error === true ||
						body.isError === true ||
						(typeof body.statusCode === "number" && body.statusCode >= 400)))
			) {
				throw new Error(
					getResponseError(
						body,
						`Customer creation failed (${response.status}).`,
					),
				);
			}

			const businessName = String(payload.businessName ?? "").trim();
			const tinNumber = String(payload.tinNumber ?? "").trim();
			const createdId = readCreatedCustomerId(body);
			const createdCustomer: CustomerRow = {
				id: createdId ?? `created-${String(payload.userId)}-${Date.now()}`,
				businessName,
				tinNumber,
				businessLicense: String(payload.businessLicense ?? ""),
				businessType: String(payload.businessType ?? ""),
				contactPerson: String(payload.contactPerson ?? ""),
				contactPhone: String(payload.contactPhone ?? ""),
				contactEmail: String(payload.contactEmail ?? ""),
				registeredAt: new Date().toISOString(),
				activeCases: null,
				kycStatus: "Pending",
			};

			form.reset();
			setFieldErrors({});
			setSearch("");
			const refreshed = await loadCustomers();
			setCustomers((current) => {
				const alreadyListed = current.some((customer) =>
					(createdId && customer.id === createdId) ||
					(customer.tinNumber && customer.tinNumber.toLowerCase() === tinNumber.toLowerCase()),
				);
				return alreadyListed ? current : [createdCustomer, ...current];
			});
			setSuccess(
				refreshed
					? `${businessName} registered successfully${createdId ? ` (ID ${createdId})` : ""}.`
					: `${businessName} was created${createdId ? ` (ID ${createdId})` : ""}, but the customer list could not be refreshed. The new record is shown below.`,
			);

			closeCreate();
		} catch (createError: unknown) {
			setSubmitError(
				createError instanceof Error
					? createError.message
					: "Unable to create customer record.",
			);
		} finally {
			setSubmitting(false);
		}
	};

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadCustomers();
		}, 0);

		return () => window.clearTimeout(timeoutId);
	}, [closeCreate, loadCustomers]);

	useEffect(() => {
		if (!createOpen) return;
		const timeoutId = window.setTimeout(() => {
			void loadCustomerAccounts();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [createOpen, loadCustomerAccounts]);

	const filteredCustomers = useMemo(() => {
		const query = search.trim().toLowerCase();

		if (!query) {
			return customers;
		}

		return customers.filter((customer) =>
			[
				customer.businessName,
				customer.tinNumber,
				customer.businessType,
				customer.contactPerson,
				customer.contactEmail,
			].some((value) =>
				value.toLowerCase().includes(query),
			),
		);
	}, [customers, search]);

	const customerStats = [
		{
			title: "Registered importers",
			value: customers.length,
			description: "Total customer records",
			icon: <Building2 className="h-4 w-4 text-blue-700" />,
			accent: "border-l-blue-600",
		},
		{
			title: "Verified",
			value: customers.filter((customer) => customer.kycStatus === "Verified").length,
			description: "KYC completed",
			icon: <ShieldCheck className="h-4 w-4 text-emerald-700" />,
			accent: "border-l-emerald-600",
		},
		{
			title: "Pending review",
			value: customers.filter((customer) => customer.kycStatus === "Pending").length,
			description: "Awaiting verification",
			icon: <Clock3 className="h-4 w-4 text-amber-700" />,
			accent: "border-l-amber-600",
		},
		{
			title: "Needs revision",
			value: customers.filter((customer) => customer.kycStatus === "Revision").length,
			description: "Requires updated information",
			icon: <RotateCcw className="h-4 w-4 text-rose-700" />,
			accent: "border-l-rose-600",
		},
	];

	const formatRegisteredAt = (value: string) => {
		if (!value) {
			return "—";
		}

		const date = new Date(value);

		return Number.isNaN(date.getTime())
			? "—"
			: date.toLocaleDateString(undefined, {
					day: "2-digit",
					month: "short",
					year: "numeric",
				});
	};

	return (
		<EncoderSectionLayout
			activeSection={createPage ? "create-customer" : "customers"}
			title={createPage ? "Create customer" : "Customers"}
			description="Registered importers, their KYC state and active caseload."
		>
			<section className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between sm:pb-6">
				<div>
					<p className="text-xs font-medium uppercase tracking-[0.12em] text-blue-700">
						Data entry
					</p>
					<h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
						Customer registry
					</h2>
					<p className="mt-1 text-sm text-slate-500">
						Manage importer records, KYC status, and customer activity.
					</p>
				</div>

				<button
					type="button"
					onClick={() => {
						setSubmitError(null);
						setCustomerAccountsError(null);
						setCustomerAccountsLoading(true);
						setCreateOpen(true);
					}}
					className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
				>
					<Plus className="h-4 w-4" />
					Create customer
				</button>
			</section>

			<section
				aria-label="Customer registry summary"
				className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
			>
				{customerStats.map((stat) => (
					<div
						key={stat.title}
						className={`min-w-0 rounded-md border border-l-2 border-slate-200 bg-white p-4 shadow-sm ${stat.accent}`}
					>
						<div className="flex items-start justify-between gap-3">
							<p className="text-xs font-medium text-slate-600">{stat.title}</p>
							{stat.icon}
						</div>
						<p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
							{loading && customers.length === 0 ? "—" : stat.value}
						</p>
						<p className="mt-1 text-xs text-slate-500">{stat.description}</p>
					</div>
				))}
			</section>

			<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
				<header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
					<div>
						<h3 className="text-base font-semibold tracking-tight text-slate-900">
							Customer directory
						</h3>

						<p className="mt-1 text-xs text-slate-500">
							{loading
								? "Loading customer records…"
								: `${filteredCustomers.length} of ${customers.length} importers`}
						</p>
					</div>
				</header>

				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 sm:px-7">
					<div className="relative min-w-[220px] flex-1 sm:max-w-sm">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

						<input
							value={search}
							onChange={(event) =>
								setSearch(event.target.value)
							}
							placeholder="Search customers"
							aria-label="Search customers"
							className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
						/>
					</div>

					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={() => void loadCustomers()}
							disabled={loading}
							aria-label="Refresh customer list"
							className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
						>
							<RefreshCw
								className={`h-3.5 w-3.5 ${
									loading ? "animate-spin" : ""
								}`}
							/>
							Refresh
						</button>
					</div>
				</div>

				{error && (
					<p
						role="alert"
						className="m-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
					>
						{error}
					</p>
				)}

				{serviceDataError && (
					<p
						role="status"
						className="m-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
					>
						Customer records loaded, but case counts could not be refreshed: {serviceDataError}
					</p>
				)}

				{success && (
					<p
						role="status"
						className="m-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
					>
						{success}
					</p>
				)}

				<div className="overflow-x-auto">
					<table className="w-full min-w-[880px] text-left">
						<thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
							<tr>
								<th
									scope="col"
									className="px-5 py-3 sm:px-7"
								>
									Importer
								</th>

								<th
									scope="col"
									className="px-4 py-3"
								>
									TIN
								</th>

								<th
									scope="col"
									className="px-4 py-3"
								>
									Category
								</th>

								<th
									scope="col"
									className="px-4 py-3"
								>
									KYC
								</th>

								<th
									scope="col"
									className="px-4 py-3"
								>
									Active cases
								</th>

								<th
									scope="col"
									className="px-5 py-3 sm:px-7"
								>
									Registered
								</th>
							</tr>
						</thead>

						<tbody className="divide-y divide-slate-100">
							{filteredCustomers.map((customer) => {
								const statusClass =
									customer.kycStatus === "Verified"
										? "border-emerald-200 bg-emerald-50 text-emerald-800"
										: customer.kycStatus === "Revision"
											? "border-amber-200 bg-amber-50 text-amber-800"
											: "border-blue-200 bg-blue-50 text-blue-800";

								return (
									<tr
										key={customer.id}
										className="transition hover:bg-slate-50/80"
									>
										<td className="px-5 py-3.5 sm:px-7">
											<p className="text-sm font-semibold text-slate-900">
												{customer.businessName ||
													"Unnamed importer"}
											</p>

											<p className="mt-0.5 text-xs text-slate-500">
												{[
													customer.contactPerson,
													customer.contactEmail ||
														customer.contactPhone,
												]
													.filter(Boolean)
													.join(" · ") ||
													"Contact details unavailable"}
											</p>
										</td>

										<td className="px-4 py-3.5 font-mono text-xs text-slate-700">
											{customer.tinNumber || "—"}
										</td>

										<td className="px-4 py-3.5 text-sm text-slate-700">
											{customer.businessType || "—"}
										</td>

										<td className="px-4 py-3.5">
											<span
												className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}
											>
												{customer.kycStatus}
											</span>
										</td>

										<td className="px-4 py-3.5 text-sm tabular-nums text-slate-700">
											{customer.activeCases ?? "—"}
										</td>

										<td className="px-5 py-3.5 text-sm text-slate-600 sm:px-7">
											{formatRegisteredAt(
												customer.registeredAt,
											)}
										</td>
									</tr>
								);
							})}

							{loading &&
								customers.length === 0 && (
									<tr>
										<td
											colSpan={6}
											className="px-5 py-12 text-center text-sm text-slate-500"
										>
											Loading customer records…
										</td>
									</tr>
								)}

							{!loading &&
								!error &&
								filteredCustomers.length === 0 && (
									<tr>
										<td
											colSpan={6}
											className="px-5 py-12 text-center text-sm text-slate-500"
										>
											{search
												? "No customers match your search."
												: "No customer records found."}
										</td>
									</tr>
								)}
						</tbody>
					</table>
				</div>
			</section>

			{createOpen && (
				<div
					className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"
					onMouseDown={(event) => {
						if (
							event.target === event.currentTarget &&
							!submitting
						) {
							closeCreate();
						}
					}}
				>
					<section
						role="dialog"
						aria-modal="true"
						aria-labelledby="create-customer-title"
						className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
					>
						<div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
									Data entry
								</p>

								<h2
									id="create-customer-title"
									className="mt-1 text-lg font-semibold text-slate-900"
								>
									Create customer
								</h2>

								<p className="mt-1 text-sm text-slate-500">
									Register an importer in the customer directory.
								</p>
							</div>

							<button
								type="button"
								aria-label="Close customer form"
								onClick={closeCreate}
								disabled={submitting}
								className="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						<form
							ref={customerFormRef}
							onSubmit={createCustomer}
							noValidate
							onChange={(event) => {
								const target = event.nativeEvent.target;
								const fieldName =
									target instanceof HTMLInputElement ||
									target instanceof HTMLSelectElement ||
									target instanceof HTMLTextAreaElement
										? target.name
										: "";
								if (fieldName && fieldErrors[fieldName]) {
									setFieldErrors((current) => {
										const next = { ...current };
										delete next[fieldName];
										return next;
									});
								}
							}}
							className="space-y-5 p-5 sm:p-6"
						>
							{submitError && (
								<p
									role="alert"
									className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
								>
									{submitError}
								</p>
							)}

							<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
								<div className="mb-4">
									<h3 className="text-sm font-semibold text-slate-900">1. Customer account</h3>
									<p className="mt-1 text-xs text-slate-500">Select an existing login or create a new customer account.</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<label className="block text-sm font-medium text-slate-700 sm:col-span-2">
										Customer login account <span className="text-rose-600">*</span>
										<select
											name="userId"
											value={selectedAccountId}
											required
											aria-invalid={Boolean(fieldErrors.userId)}
											aria-describedby={fieldErrors.userId ? "userId-error" : "userId-help"}
											onChange={(event) => setSelectedAccountId(event.target.value)}
											disabled={customerAccountsLoading}
											className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
										>
											<option value="">
												{customerAccountsLoading
													? "Loading active customer accounts…"
													: customerAccounts.length
														? "Select an active customer account"
														: "No active customer accounts available"}
											</option>
											{customerAccounts.map((account) => (
												<option key={account.id} value={account.id}>{account.label}</option>
											))}
										</select>
										<span id="userId-help" className="mt-1 block text-xs text-slate-500">
											Choose an existing account, or create a new one here. Its contact details will be added to the customer record.
										</span>
										{fieldErrors.userId && <span id="userId-error" role="alert" className="mt-1 block text-xs text-rose-700">{fieldErrors.userId}</span>}
										{customerAccountsError && (
											<span role="alert" className="mt-1 block text-xs text-rose-700">
												{customerAccountsError}{" "}
												<button type="button" onClick={() => {
													setCustomerAccountsError(null);
													setCustomerAccountsLoading(true);
													void loadCustomerAccounts();
												}} className="font-semibold underline">
													Retry
												</button>
											</span>
										)}
									</label>
										<div className="sm:col-span-2 -mt-3">
											<button
												type="button"
												onClick={() => {
													setAccountCreateOpen((open) => !open);
													setAccountCreateError(null);
													setAccountFieldErrors({});
												}}
												className="text-xs font-semibold text-blue-700 underline"
											>
												{accountCreateOpen ? "Cancel new account" : "＋ Create a new customer account"}
											</button>
										</div>
										{accountCreateOpen && (
											<div className="sm:col-span-2 rounded-md border border-slate-200 p-4">
												<p className="mb-3 text-sm font-semibold text-slate-800">New customer account</p>
												<p className="mb-4 text-xs text-slate-500">The account will be assigned the Customer or Importer role. All fields are required.</p>
												<div className="grid gap-4 sm:grid-cols-2">
													{([
														["firstName", "First name", "text"],
														["lastName", "Last name", "text"],
														["username", "Username", "text"],
														["email", "Email address", "email"],
														["phone", "Phone number", "tel"],
														["password", "Password", "password"],
													] as const).map(([field, label, type]) => (
														<label key={field} className="block text-sm font-medium text-slate-700">
															{label} <span className="text-rose-600">*</span>
															<input
																value={newAccount[field]}
																type={type}
																autoComplete={field === "password" ? "new-password" : "off"}
																onChange={(event) => {
																	setNewAccount((current) => ({ ...current, [field]: event.target.value }));
																	setAccountFieldErrors((current) => {
																		const next = { ...current };
																		delete next[field];
																		return next;
																	});
																}}
																aria-invalid={Boolean(accountFieldErrors[field])}
																className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
															/>
															{accountFieldErrors[field] && <span role="alert" className="mt-1 block text-xs text-rose-700">{accountFieldErrors[field]}</span>}
														</label>
													))}
													<label className="block text-sm font-medium text-slate-700 sm:col-span-2">
														Profile photo <span className="text-rose-600">*</span>
														<input
															type="file"
															accept="image/jpeg,image/png,image/webp"
															onChange={(event) => {
																setProfilePhoto(event.target.files?.[0] ?? null);
																setAccountFieldErrors((current) => {
																	const next = { ...current };
																	delete next.profilePhoto;
																	return next;
																});
															}}
															aria-invalid={Boolean(accountFieldErrors.profilePhoto)}
															className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-blue-700"
														/>
														<span className="mt-1 block text-xs font-normal text-slate-500">JPG, PNG, or WEBP; maximum 5 MB.</span>
														{accountFieldErrors.profilePhoto && <span role="alert" className="mt-1 block text-xs text-rose-700">{accountFieldErrors.profilePhoto}</span>}
													</label>
													{accountCreateError && <p role="alert" className="text-xs text-rose-700 sm:col-span-2">{accountCreateError}</p>}
													<div className="sm:col-span-2 flex justify-end">
														<button
															type="button"
															onClick={() => void createCustomerAccount()}
															disabled={accountCreating}
															className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
														>
															{accountCreating ? "Creating account…" : "Create and select account"}
														</button>
													</div>
												</div>
											</div>
										)}
								</div>
							</section>

							<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
								<div className="mb-4">
									<h3 className="text-sm font-semibold text-slate-900">2. Business registration</h3>
									<p className="mt-1 text-xs text-slate-500">Enter the importer’s registered business and license details.</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									{[
										["businessName", "Business name", "text"],
										["businessType", "Business type", "text"],
										["tinNumber", "TIN number", "text"],
										["businessLicense", "Business license", "text"],
										["importLicense", "Import license", "text"],
									].map(([name, label, type]) => (
										<label key={name} className="block text-sm font-medium text-slate-700">
											{label}
											<input
												name={name}
												type={type}
												required
												maxLength={160}
												aria-invalid={Boolean(fieldErrors[name])}
												aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
												className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
											/>
											{fieldErrors[name] && <span id={`${name}-error`} role="alert" className="mt-1 block text-xs text-rose-700">{fieldErrors[name]}</span>}
										</label>
									))}
									<label className="block text-sm font-medium text-slate-700">
										Import license expiry
										<input
											name="importLicenseExpiry"
											type="date"
											aria-invalid={Boolean(fieldErrors.importLicenseExpiry)}
											aria-describedby={fieldErrors.importLicenseExpiry ? "importLicenseExpiry-error" : undefined}
											className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
										/>
										{fieldErrors.importLicenseExpiry && <span id="importLicenseExpiry-error" role="alert" className="mt-1 block text-xs text-rose-700">{fieldErrors.importLicenseExpiry}</span>}
									</label>
								</div>
							</section>

							<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
								<div className="mb-4">
									<h3 className="text-sm font-semibold text-slate-900">Primary contact</h3>
									<p className="mt-1 text-xs text-slate-500">Add the person who will manage this importer account.</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									{[
										["contactPerson", "Contact person", "text"],
										["contactPhone", "Contact phone", "tel"],
										["contactEmail", "Contact email", "email"],
									].map(([name, label, type]) => (
										<label key={name} className="block text-sm font-medium text-slate-700">
											{label}
											<input
												name={name}
												type={type}
												required
												maxLength={160}
												aria-invalid={Boolean(fieldErrors[name])}
												aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
												className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
											/>
											{fieldErrors[name] && <span id={`${name}-error`} role="alert" className="mt-1 block text-xs text-rose-700">{fieldErrors[name]}</span>}
										</label>
									))}
								</div>
							</section>

							<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
								<div className="mb-4">
									<h3 className="text-sm font-semibold text-slate-900">Business address</h3>
									<p className="mt-1 text-xs text-slate-500">Provide the registered business location.</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-3">
									{[
										["city", "City"],
										["state", "State / region"],
										["postalCode", "Postal code"],
									].map(([name, label]) => (
										<label key={name} className="block text-sm font-medium text-slate-700">
											{label}
											<input
												name={name}
												type="text"
												required
												maxLength={160}
												aria-invalid={Boolean(fieldErrors[name])}
												aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
												className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
											/>
											{fieldErrors[name] && <span id={`${name}-error`} role="alert" className="mt-1 block text-xs text-rose-700">{fieldErrors[name]}</span>}
										</label>
									))}
									<label className="block text-sm font-medium text-slate-700 sm:col-span-3">
										Full business address
										<textarea
											name="businessAddress"
											required
											maxLength={500}
											rows={3}
											aria-invalid={Boolean(fieldErrors.businessAddress)}
											aria-describedby={fieldErrors.businessAddress ? "businessAddress-error" : undefined}
											className="mt-1.5 w-full rounded-md border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
										/>
										{fieldErrors.businessAddress && <span id="businessAddress-error" role="alert" className="mt-1 block text-xs text-rose-700">{fieldErrors.businessAddress}</span>}
									</label>
								</div>
							</section>

							<div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
								<button
									type="button"
									onClick={() =>
										closeCreate()
									}
									disabled={submitting}
									className="rounded-md border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
								>
									Cancel
								</button>

								<button
									type="submit"
									disabled={submitting || customerAccountsLoading || !selectedAccountIsAvailable}
									className="rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{submitting
										? "Creating customer…"
										: !selectedAccountIsAvailable && !customerAccountsLoading
											? "Select or create an account first"
											: "Create customer"}
								</button>
							</div>
						</form>
					</section>
				</div>
			)}
		</EncoderSectionLayout>
	);
}