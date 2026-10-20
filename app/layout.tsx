import type { Metadata, Viewport } from 'next';
import { Kanit, Inter } from 'next/font/google';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

const kanit = Kanit({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-kanit',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VES-PD — Vesper Police Department',
  description: 'ระบบจัดการข้อมูลเจ้าหน้าที่ตำรวจ VES-PD — Vesper PD FiveM Server',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${kanit.variable} ${inter.variable}`}>
      <body>
        <div className="scanner-line" />
        <div className="bg-glow" />
        <div className="bg-dots" />
        <ToastProvider>
          <div className="relative z-1">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
