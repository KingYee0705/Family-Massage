import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Serene Family Massage',
  description: 'Choose a massage treatment and request your preferred appointment time.',
  openGraph: {
    title: 'Serene Family Massage',
    description: 'Rest, restore, and request a thoughtful massage for you and your loved ones.',
    type: 'website',
    images: [{
      url: '/og.png',
      width: 1200,
      height: 630,
      alt: 'Serene Family Massage — Rest, Restore, Reconnect',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Serene Family Massage',
    description: 'Rest, restore, and request a thoughtful massage for you and your loved ones.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
