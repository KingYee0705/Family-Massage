import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Serene Family Massage',
  description: 'Choose a massage treatment and request your preferred appointment time.',
  openGraph: {
    title: 'Serene Family Massage',
    description: 'Rest, restore, and request a thoughtful massage for you and your loved ones.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Serene Family Massage',
    description: 'Rest, restore, and request a thoughtful massage for you and your loved ones.',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
