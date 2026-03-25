import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fitsy — Find food that fits your macros",
  description:
    "Fitsy finds restaurants near you with meals that match your protein, carb, and fat targets. Eat out without blowing your plan.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
