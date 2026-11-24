import { normalizeApiBaseUrl } from "@/modules/utils/axios/config";

const backendBaseUrl = normalizeApiBaseUrl(
  process.env.BACKEND_API_URL ??
    process.env.NEXT_PUBLIC_AUTH_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL,
);

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    const isFormDataRequest = contentType.includes("multipart/form-data");
    const backendUrl = `${backendBaseUrl}/User/Create`;

    if (isFormDataRequest) {
      const formData = await request.formData();
      const response = await fetch(backendUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });

      const responseText = await response.text();
      const headers = new Headers({
        "Cache-Control": "no-store",
      });
      const contentTypeHeader = response.headers.get("content-type");
      if (contentTypeHeader) {
        headers.set("Content-Type", contentTypeHeader);
      }

      return new Response(responseText, {
        status: response.status,
        headers,
      });
    }

    const rawBody = await request.text();
    const payload = rawBody && rawBody.trim() ? JSON.parse(rawBody) : {};

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const responseText = await response.text();
    const headers = new Headers({
      "Cache-Control": "no-store",
    });
    const contentTypeHeader = response.headers.get("content-type");
    if (contentTypeHeader) {
      headers.set("Content-Type", contentTypeHeader);
    }

    return new Response(responseText, {
      status: response.status,
      headers,
    });
  } catch (error: unknown) {
    console.error("User signup proxy request failed:", error);
    return Response.json(
      { error: "Unable to reach the authentication service. Check that the API is running." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
