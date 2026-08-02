import type { Metadata, Viewport } from "next";
import { Geist, Hanken_Grotesk, Inter } from "next/font/google";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
