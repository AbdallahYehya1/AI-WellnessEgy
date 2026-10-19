import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Parameters Supabase adds when it sends an email link back to the Site URL instead
// of /auth/confirm (redirect URL not on the allow-list, or a template linking to
// {{ .SiteURL }}). Forward them unchanged so the link is verified, not ignored.
const AUTH_CALLBACK_PARAMS = ["code", "token_hash", "error", "error_code"];

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/" && AUTH_CALLBACK_PARAMS.some((p) => searchParams.has(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/confirm";
    return NextResponse.redirect(url);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
