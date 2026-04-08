import type { Metadata } from 'next';
import { DM_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const dmSans = DM_Sans({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DietMap — Find Safe Restaurants Near You',
  description: 'Discover restaurants that cater to your dietary restrictions, with community-verified safety ratings.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${dmSans.className} h-full`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
