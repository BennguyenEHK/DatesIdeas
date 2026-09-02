import type { Metadata } from "next";
import { Poiret_One, Inter } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poiret.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
