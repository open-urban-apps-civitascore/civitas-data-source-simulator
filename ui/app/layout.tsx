import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Datensimulator · CIVITAS/CORE",
  description: "Simulierte Sensordaten für CIVITAS/CORE v2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
