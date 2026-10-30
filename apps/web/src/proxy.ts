import { type NextRequest, NextResponse } from "next/server";
import { PAY_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import { EMBED_PARAMS } from "@/features/pay/constants/embed";
import { contentSecurityPolicy } from "@/shared/config/security-headers";

const CHECK_MS = 5000;

// R-168: an embed may be framed only by the origin it names, when the invoice's store allows it. The api answers
// yes only for an origin exactly as a browser writes it, so it goes into the header as it is. Anything else, a
// failed check included, is framed by no one.
export async function proxy(request: NextRequest) {
  const token = request.nextUrl.pathname.split("/")[2] ?? "";
  const origin = request.nextUrl.searchParams.get(EMBED_PARAMS.origin) ?? "";
  const allowed = PAY_TOKEN_PATTERN.test(token) && (await embedAllowed(token, origin));
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy(allowed ? origin : "'none'"),
  );
  return response;
}

async function embedAllowed(token: string, origin: string): Promise<boolean> {
  try {
    const answer = await fetch(
      `${process.env.API_URL}/v1/invoices/${token}/embed?origin=${encodeURIComponent(origin)}`,
      { cache: "no-store", signal: AbortSignal.timeout(CHECK_MS) },
    );
    return answer.ok && (await answer.json()).allowed === true;
  } catch {
    return false;
  }
}

export const config = { matcher: "/embed/:path*" };
