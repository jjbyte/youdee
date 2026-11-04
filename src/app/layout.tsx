import type { Metadata } from 'next';
import '../../design-system/design-tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '有底 · 物料库',
    template: '%s · 有底',
  },
  description: '公司价格底账。报价前先看一眼。',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" data-density="standard">
      <body>{children}</body>
    </html>
  );
}
