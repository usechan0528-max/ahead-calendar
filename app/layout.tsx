import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ahead-calendar-kr-prototype.dldydcks0528.chatgpt.site'),
  title: 'J에게 (To J) — 계획이 일상이 되도록',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'J에게', statusBarStyle: 'default' },
  description:
    '일정과 기념일을 준비하고, 매일의 실천을 쌓으며 P에서 J로 성장하는 계획 도우미.',
  openGraph: {
    title: 'J에게 (To J) — 계획이 일상이 되도록',
    description: '계획, 알림, 그리고 필요한 준비를 꼭 맞는 시점에 알려드려요.',
    type: 'website',
    images: [
      {
        url: 'https://ahead-calendar-kr-prototype.dldydcks0528.chatgpt.site/og.png',
        width: 1200,
        height: 630,
        alt: 'ahead. Be ready before it matters.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'J에게 (To J) — 계획이 일상이 되도록',
    description: '계획, 알림, 그리고 필요한 준비를 꼭 맞는 시점에 알려드려요.',
    images: ['https://ahead-calendar-kr-prototype.dldydcks0528.chatgpt.site/og.png'],
  },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#294e3e' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" /></head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
