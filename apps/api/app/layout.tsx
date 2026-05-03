import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Newsreader, Outfit, Fraunces, Nunito_Sans } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader",
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  // Variable font + optical size axis — without `opsz`, Fraunces renders large
  // headings using its body cut, which looks chunky and over-sized.
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const nunito = Nunito_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nunito",
  weight: ["300", "400", "600", "700"],
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
