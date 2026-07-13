import { betterFetch } from "@better-fetch/fetch";
import type { Session } from "better-auth/types";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Only protect dashboard and check login page
  if (pathname.startsWith("/dashboard") || pathname === "/login") {
    const { data: session } = await betterFetch<Session>(
      "/api/auth/get-session",
      {
        baseURL: "http://localhost:3000",
        headers: {
          cookie: request.headers.get("cookie") || "",
        },
      },
    );

    if (!session && pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (session && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
