"use client";

import { Suspense } from "react";
import { AuthModal } from "./AuthModal";

// AuthModal renders LoginForm, which reads useSearchParams() — Next.js
// requires a Suspense boundary somewhere above any component using that
// hook, or the page it's mounted in gets forced into fully dynamic
// rendering. Scoping the boundary to just this wrapper (mounted once at
// the root layout, see app/layout.tsx) keeps that cost local instead of
// de-opting every static page in the app.
export function AuthModalRoot() {
  return (
    <Suspense fallback={null}>
      <AuthModal />
    </Suspense>
  );
}
