import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Administration Le Ter', template: '%s · Administration Le Ter' },
  description: 'Plateforme d’administration de Le Ter.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#22314f' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <a
          href="#contenu"
          className="focus:bg-surface focus:shadow-raised sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:px-3 focus:py-2"
        >
          Aller au contenu
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
