import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cena con delitto',
  description: 'Le nostre cene con delitto, sul telefono e senza spoiler.',
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/manifest.webmanifest`,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#14110f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
