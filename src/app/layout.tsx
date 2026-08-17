import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { ServiceWorker } from '@/components/ServiceWorker';
import { AppFrame } from '@/components/AppFrame';

/**
 * Next rewrites its OWN asset URLs for basePath, but leaves `metadata.manifest`
 * and `metadata.icons` exactly as written. On a sub-path deploy that produced
 * href="/manifest.webmanifest" while the app lived at /Bluddian/ — a 404, which
 * silently downgrades the Chrome install to a plain bookmark that opens in a
 * browser tab. These must be prefixed by hand.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Bluddian',
  description: 'Private founder dashboard. Runs entirely on your phone.',
  applicationName: 'Bluddian',
  manifest: `${BASE}/manifest.webmanifest`,
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Bluddian' },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false, nocache: true },
  icons: {
    icon: [
      { url: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { url: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: `${BASE}/icons/icon-192.png`, sizes: '192x192' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#09090a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ToastProvider>
          <AppFrame>{children}</AppFrame>
        </ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
