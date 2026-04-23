import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "100 900",
  display: "swap",
  preload: true,
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dramndi.sh'

export const metadata: Metadata = {
  title: '위스키 맵 - 내 주변 위스키 바 & 리쿼샵 탐색',
  description:
    '전국 위스키 바와 리쿼샵의 위치, 그리고 유저들의 리얼한 코멘트를 한눈에 확인하세요.',
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: '위스키 맵 - 내 주변 위스키 바 & 리쿼샵 탐색',
    description:
      '전국 위스키 바와 리쿼샵의 위치, 그리고 유저들의 리얼한 코멘트를 한눈에 확인하세요.',
    url: siteUrl,
    siteName: '위스키 맵',
    images: [
      {
        url: '/og-image.png',   // metadataBase 기준 절대 URL로 자동 해석
        width: 1200,
        height: 630,
        alt: '위스키 맵 - 내 주변 위스키 바 & 리쿼샵 탐색',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '위스키 맵 - 내 주변 위스키 바 & 리쿼샵 탐색',
    description:
      '전국 위스키 바와 리쿼샵의 위치, 그리고 유저들의 리얼한 코멘트를 한눈에 확인하세요.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
