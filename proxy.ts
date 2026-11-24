import { NextResponse, type NextRequest } from "next/server";
import { isLocale, type Locale } from "./i18n/routing";
import { getRequestLocale } from "./i18n/request";

const isLocaleLike = (value: string) => /^[a-z]{2}(?:-[a-z]{2})?$/i.test(value);

const isLegacyRoute = (pathname: string) =>
  pathname === "/encoder" ||
  pathname.startsWith("/encoder/") ||
  pathname === "/reset-password" ||
  pathname.startsWith("/reset-password/");

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    isLegacyRoute(pathname) ||
    /\/[^/]+\.[^/]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const firstSegment = pathname.split("/")[1] ?? "";
  if (isLocale(firstSegment)) {
    if (pathname === `/${firstSegment}` || pathname === `/${firstSegment}/`) {
      const destination = request.nextUrl.clone();
      destination.pathname = `/${firstSegment}/auth/login`;
      return NextResponse.redirect(destination);
    }

    const response = NextResponse.next();
    if (request.cookies.get("NEXT_LOCALE")?.value !== firstSegment) {
      response.cookies.set("NEXT_LOCALE", firstSegment as Locale, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return response;
  }

  const locale = getRequestLocale(
    request.headers.get("accept-language"),
    request.cookies.get("NEXT_LOCALE")?.value,
  );
  const destination = request.nextUrl.clone();
  const pathWithoutUnsupportedLocale = isLocaleLike(firstSegment)
    ? pathname.slice(firstSegment.length + 1) || "/"
    : pathname;
  destination.pathname = `/${locale}${
    pathWithoutUnsupportedLocale === "/" ? "/auth/login" : pathWithoutUnsupportedLocale
  }`;

  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
