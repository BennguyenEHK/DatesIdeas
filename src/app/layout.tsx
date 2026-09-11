import type { Metadata, Viewport } from "next";
import { Poiret_One, Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

const poiret = Poiret_One({
  variable: "--font-poiret",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FestiBooth",
  description: "A place for two people to spend an evening together.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FestiBooth", statusBarStyle: "black-translucent" },
};

/**
 * The letterbox colour, so the phone's own chrome joins the room rather than
 * framing it in white. Separate from `metadata` because Next wants viewport
 * concerns declared on their own export.
 */
export const viewport: Viewport = {
  themeColor: "#080b1c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poiret.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
