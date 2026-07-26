import type { Metadata, Viewport } from "next";
import { Geist, Hanken_Grotesk, Inter } from "next/font/google";
import type { ReactNode } from "react";
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
  description: "Live streaming and birr gifting for Ethiopian creators",
};

export const viewport: Viewport = {
  themeColor: "#0b1326",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${hankenGrotesk.variable} ${inter.variable} ${geist.variable}`}>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
