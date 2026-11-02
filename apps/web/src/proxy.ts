import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate: redirects based on the presence of the session cookie only (no network call).
 * Real authorization happens in every server component / API route, which validate the session
 * and the caller's team membership.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (pathname.startsWith("/dashboard") && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && hasSession) {
    const next = request.nextUrl.searchParams.get("next");
    const local = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
    return NextResponse.redirect(new URL(local ? next : "/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
