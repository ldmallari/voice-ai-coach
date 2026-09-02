import type { Metadata } from 'next';
import { Bricolage_Grotesque, Onest } from 'next/font/google';
import './globals.css';

const onest = Onest({ subsets: ['latin'], variable: '--font-onest', display: 'swap' });
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Voice AI Coach',
  description: 'AI business coach for aesthetic clinic owners',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${bricolage.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
