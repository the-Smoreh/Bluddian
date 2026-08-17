import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { ServiceWorker } from '@/components/ServiceWorker';

export const metadata: Metadata = {
  title: 'Bluddian',
  description: 'Private founder dashboard — revenue, products, courses, Claude spend, and goals.',
  applicationName: 'Bluddian',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Bluddian' },
  formatDetection: { telephone: false, email: false, address: false },
  // This app is private; make sure it never ends up in an index.
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
  // Let the app paint under the status bar and gesture pill on the Pixel.
  viewportFit: 'cover',
  // Allow zoom: locking it out is an accessibility failure, and the layout
  // holds up fine when zoomed.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
