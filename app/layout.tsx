import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dram & Dish",
  description: "나만의 위스키 바·리쿼샵·맛집 지도",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
