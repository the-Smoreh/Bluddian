import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { ServiceWorker } from '@/components/ServiceWorker';
import { AppFrame } from '@/components/AppFrame';

export const metadata: Metadata = {
  title: 'Bluddian',
  description: 'Private founder dashboard. Runs entirely on your phone.',
  applicationName: 'Bluddian',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Bluddian' },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false, nocache: true },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#08080c',
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
