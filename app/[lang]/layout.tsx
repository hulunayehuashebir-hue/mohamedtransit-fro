import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/routing";

interface RootLayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function LanguageLayout({
  children,
  params,
}: RootLayoutProps) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return <div lang={lang} className="contents">{children}</div>;
}