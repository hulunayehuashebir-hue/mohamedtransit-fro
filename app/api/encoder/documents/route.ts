import { NextResponse } from "next/server";
import { API_ROUTES } from "@/modules/api";
import {
	DataEncoderIdentityError,
	proxyDataEncoderRequest,
	resolveDataEncoderIdentity,
} from "@/app/api/encoder/data-encoder-proxy";

const isPositiveId = (value: FormDataEntryValue | null): value is string =>
	typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0;

export async function GET(request: Request) {
	const incomingUrl = new URL(request.url);
	const documentId = incomingUrl.searchParams.get("downloadId")?.trim() ?? "";
	if (!/^[1-9]\d*$/.test(documentId) || !Number.isSafeInteger(Number(documentId))) {
		return NextResponse.json({ error: "A valid document ID is required." }, { status: 400 });
	}

	return proxyDataEncoderRequest(
		request,
		"GET",
		`${API_ROUTES.document.downloadDocument}?documentId=${encodeURIComponent(documentId)}`,
	);
}

export async function POST(request: Request) {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return NextResponse.json({ error: "A multipart document upload is required." }, { status: 400 });
	}

	const file = formData.get("File");
	if (!file || typeof file === "string") {
		return NextResponse.json({ error: "Select a document to upload." }, { status: 400 });
	}
	const extensionAllowed = /\.(pdf|jpe?g|png|xlsx)$/i.test(file.name);
	const mimeAllowed = !file.type || [
		"application/pdf",
		"image/jpeg",
		"image/png",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	].includes(file.type);
	if (!extensionAllowed || !mimeAllowed) {
		return NextResponse.json({ error: "Choose a PDF, JPG, PNG, or XLSX document." }, { status: 400 });
	}
	if (file.size > 25 * 1024 * 1024) {
		return NextResponse.json({ error: "The document must be 25 MB or smaller." }, { status: 400 });
	}
	if (!isPositiveId(formData.get("ServiceId"))) {
		return NextResponse.json({ error: "A valid service ID is required." }, { status: 400 });
	}
	if (!isPositiveId(formData.get("ServiceStageId"))) {
		return NextResponse.json({ error: "A valid service stage ID is required." }, { status: 400 });
	}
	const documentType = formData.get("DocumentType");
	if (typeof documentType !== "string" || !documentType.trim()) {
		return NextResponse.json({ error: "A document type is required." }, { status: 400 });
	}

	let identity: Awaited<ReturnType<typeof resolveDataEncoderIdentity>>;
	try {
		identity = await resolveDataEncoderIdentity(request);
	} catch (error: unknown) {
		if (error instanceof DataEncoderIdentityError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		console.error("Unable to identify the signed-in data encoder:", error);
		return NextResponse.json(
			{ error: "Unable to identify the signed-in data encoder." },
			{ status: 502 },
		);
	}
	if (!identity) {
		return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	}

	formData.set("DocumentType", documentType.trim());
	formData.set("CreatedByDataEncoderId", identity.userId);
	const forwardedRequest = new Request(request.url, {
		method: "POST",
		headers: {
			...(request.headers.get("authorization")
				? { Authorization: request.headers.get("authorization")! }
				: {}),
			Accept: request.headers.get("accept") ?? "application/json",
		},
		body: formData,
	});

	return proxyDataEncoderRequest(
		forwardedRequest,
		"POST",
		API_ROUTES.document.uploadServiceDocument,
	);
}