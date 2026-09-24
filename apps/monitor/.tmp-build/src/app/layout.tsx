import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Monitor Dashboard',
  description: 'Monitoring dashboard for Wideo11',
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {children}
    </div>
  );
}