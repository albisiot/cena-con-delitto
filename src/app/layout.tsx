import type { Metadata, Viewport } from 'next';
import { Courier_Prime, Special_Elite } from 'next/font/google';
import './globals.css';

const courier = Courier_Prime({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-courier' });
const elite = Special_Elite({ weight: '400', subsets: ['latin'], variable: '--font-elite' });

export const metadata: Metadata = {
  title: 'Cena con delitto',
  description: 'Le nostre cene con delitto, sul telefono e senza spoiler.',
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/manifest.webmanifest`,
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
