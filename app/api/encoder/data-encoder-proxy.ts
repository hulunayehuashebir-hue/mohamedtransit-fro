import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeApiBaseUrl } from "@/modules/utils/axios/config";

const readAccessToken = async (request: Request): Promise<string | null> => {
	const authorization = request.headers.get("authorization");
	const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
	if (bearerToken) return bearerToken;

	const cookieStore = await cookies();
	return (
		cookieStore.get("accessToken")?.value ??
		cookieStore.get("transit-portal-accessToken")?.value ??
		cookieStore.get("MohamedTransit-portal-accessToken")?.value ??
		null
	);
};

const readUserId = (value: unknown, depth = 0): string | null => {
	if (depth > 8 || typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}

	const record = value as Record<string, unknown>;
	for (const key of ["userId", "id", "accountId", "sub"]) {
		const actualKey = Object.keys(record).find(
			(candidate) => candidate.toLowerCase() === key.toLowerCase(),
		);
		const candidate = actualKey ? record[actualKey] : undefined;
		const id = typeof candidate === "number" || typeof candidate === "string"
			? String(candidate).trim()
			: "";
		if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) return id;
	}

	for (const key of ["data", "payload", "response", "result", "profile", "user", "account"]) {
		const actualKey = Object.keys(record).find(
			(candidate) => candidate.toLowerCase() === key,
		);
		const nested = actualKey ? record[actualKey] : undefined;
		const id = readUserId(nested, depth + 1);
		if (id) return id;
	}

	return null;
};

export class DataEncoderIdentityError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export const resolveDataEncoderIdentity = async (
	request: Request,
): Promise<{ accessToken: string; userId: string } | null> => {
	const accessToken = await readAccessToken(request);
	if (!accessToken) return null;

	const configuredId = process.env.DATA_ENCODER_USER_ID?.trim();
	if (configuredId) {
		if (!/^[1-9]\d*$/.test(configuredId) || !Number.isSafeInteger(Number(configuredId))) {
			throw new DataEncoderIdentityError("DATA_ENCODER_USER_ID must be a positive integer.", 500);
		}
		return { accessToken, userId: configuredId };
	}

	const backendUrl = normalizeApiBaseUrl(
		process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
	);
	const response = await fetch(`${backendUrl}/Account/GetProfile`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
		cache: "no-store",
		signal: AbortSignal.timeout(15_000),
	});
	const text = await response.text();
	let profile: unknown = text;
	if (text) {
		try {
			profile = JSON.parse(text) as unknown;
		} catch {
			profile = text;
		}
	}
	if (!response.ok) {
		throw new DataEncoderIdentityError(
			`Unable to identify the signed-in data encoder (status ${response.status}).`,
			response.status,
		);
	}

	const userId = readUserId(profile);
	if (!userId) {
		throw new DataEncoderIdentityError(
			"The signed-in account profile did not include a valid user ID.",
			502,
		);
	}
	return { accessToken, userId };
};

export const proxyDataEncoderRequest = async (
	request: Request,
	method: "GET" | "POST" | "PUT",
	endpoint: string,
): Promise<Response> => {
	const accessToken = await readAccessToken(request);
	if (!accessToken) {
		return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	}

	const headers = new Headers({
		Authorization: `Bearer ${accessToken}`,
		Accept: request.headers.get("accept") ?? "application/json",
	});
	let body: BodyInit | undefined;

	if (method !== "GET") {
		const contentType = request.headers.get("content-type") ?? "";
		if (contentType.includes("multipart/form-data")) {
			body = await request.formData();
		} else {
			const requestText = await request.text();
			if (requestText) {
				body = requestText;
				headers.set("Content-Type", contentType || "application/json");
			}
		}
	}

	try {
		const response = await fetch(
			`${normalizeApiBaseUrl(
				process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
			)}${endpoint}`,
			{
				method,
				headers,
				body,
				cache: "no-store",
				signal: AbortSignal.timeout(20_000),
			},
		);
		const responseHeaders = new Headers({
			"Cache-Control": "no-store",
		});
		const responseType = response.headers.get("content-type");
		if (responseType) responseHeaders.set("Content-Type", responseType);
		const location = response.headers.get("Location");
		if (location) responseHeaders.set("Location", location);
		const contentDisposition = response.headers.get("Content-Disposition");
		if (contentDisposition) responseHeaders.set("Content-Disposition", contentDisposition);
		return new Response(response.body, {
			status: response.status,
			headers: responseHeaders,
		});
	} catch (error: unknown) {
		console.error(`Data encoder API request failed (${method} ${endpoint}):`, error);
		return NextResponse.json(
			{ error: "Unable to reach the Data Encoder service API." },
			{ status: 502, headers: { "Cache-Control": "no-store" } },
		);
	}
};
