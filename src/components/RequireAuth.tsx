import type { ReactNode } from "react";
import { getSession } from "../lib/session";

/* Route guard: projects and the studio require an account. The pages
   are static, so gating happens client-side — unauthenticated visits
   bounce to /login before anything renders. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  if (typeof window !== "undefined" && !getSession()) {
    window.location.href = "/login";
    return null;
  }
  return <>{children}</>;
}
