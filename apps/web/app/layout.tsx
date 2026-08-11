import type { Metadata, Viewport } from "next";
import { Geist, Hanken_Grotesk, Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { AuthModalRoot } from "@/components/AuthModalRoot";
import { IntlProvider } from "@/components/IntlProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Birq",
  description: "Live streaming and Gursha gifting for Ethiopian creators",
};

export const viewport: Viewport = {
  themeColor: "#0b1326",
};

// Runs before React hydrates so the theme is correct on first paint —
// without this, the page would always flash the dark (default) theme for
// a frame before a useEffect could read localStorage and switch it.
const THEME_INIT_SCRIPT = `
  try {
    var t = localStorage.getItem("birq-theme");
    if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  } catch (e) {}
`;

// Same detection BottomNav.tsx uses to suppress its own nav inside the
// native app's WKWebView — reused here so the embedded Explore tab's type
// can switch to the system font stack (globals.css's [data-native="true"]
// rule) instead of Birq's brand faces, which read as "a website in a
// shell" next to the camera UI's native SF Pro chrome.
async function isNativeShell() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return cookieStore.get("birq_native")?.value === "1" || (headerStore.get("user-agent") ?? "").includes("BirqApp");
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nativeShell = await isNativeShell();
  return (
    <html lang="en" suppressHydrationWarning data-native={nativeShell ? "true" : undefined}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${hankenGrotesk.variable} ${inter.variable} ${geist.variable}`}>
        <IntlProvider>
          {children}
          <ServiceWorkerRegister />
          <AuthModalRoot />
        </IntlProvider>
      </body>
    </html>
  );
}
