import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader.woff2", weight: "400", style: "normal" },
    { path: "./fonts/newsreader.woff2", weight: "700", style: "normal" },
    { path: "./fonts/newsreader-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/newsreader-italic.woff2", weight: "700", style: "italic" },
  ],
  display: "swap",
  variable: "--font-newsreader",
});

const outfit = localFont({
  src: "./fonts/outfit.woff2",
  display: "swap",
  variable: "--font-body",
  weight: "100 900",
});

const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/fraunces-italic.woff2", weight: "100 900", style: "italic" },
  ],
  display: "swap",
  variable: "--font-fraunces",
  // Both local files retain the optical size axis used by the display CSS.
});

const nunito = localFont({
  src: [
    { path: "./fonts/nunito-sans.woff2", weight: "300", style: "normal" },
    { path: "./fonts/nunito-sans.woff2", weight: "400", style: "normal" },
    { path: "./fonts/nunito-sans.woff2", weight: "600", style: "normal" },
    { path: "./fonts/nunito-sans.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "Fitsy — Find food that fits your macros",
  description:
    "Fitsy finds restaurants near you with meals that match your protein, carb, and fat targets. Eat out without blowing your plan.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${outfit.variable} ${fraunces.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
