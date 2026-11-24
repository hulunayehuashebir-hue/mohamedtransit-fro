import { redirect } from "next/navigation";

export default async function LegacyCustomerRequestPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/customer/services/new`);
}
