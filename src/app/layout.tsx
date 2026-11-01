import type { Metadata, Viewport } from 'next';
import { Courier_Prime, Special_Elite } from 'next/font/google';
import './globals.css';

const courier = Courier_Prime({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-courier' });
const elite = Special_Elite({ weight: '400', subsets: ['latin'], variable: '--font-elite' });

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Cena con delitto',
  description: 'Le nostre cene con delitto, sul telefono e senza spoiler.',
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icons/icon-192.png`, apple: `${base}/icons/apple-touch-icon.png` },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#cfba85',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${courier.variable} ${elite.variable}`}>
      <body>{children}</body>
    </html>
  );
}
