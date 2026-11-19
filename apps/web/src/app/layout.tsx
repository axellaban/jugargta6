import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'JugarGTA6';

export const metadata: Metadata = {
  title: `${siteName} — jugá por turnos desde el navegador`,
  description: 'Hacé fila, tomá el control y jugá desde el navegador con joystick, teclado o el celular. Turnos de 10 minutos.',
  applicationName: siteName,
};

export const viewport: Viewport = {
  themeColor: '#07060b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
