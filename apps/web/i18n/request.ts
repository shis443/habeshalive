import { getRequestConfig } from "next-intl/server";

// No locale-prefixed routing and no per-request locale resolution here —
// see components/IntlProvider.tsx's comment for why: locale switching is a
// client-only localStorage preference in this app (same pattern as
// useTheme), not a URL or cookie. This file exists only because
// next-intl's Next.js plugin requires it; the "en" default here is what
// server-rendered output uses before IntlProvider takes over client-side,
// and IntlProvider always overrides locale/messages for its subtree.
export default getRequestConfig(async () => ({
  locale: "en",
  timeZone: "Africa/Addis_Ababa",
}));
