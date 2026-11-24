import { redirect } from "next/navigation";
import CustomerDashboardPage from "../dashboard/page";

export default async function CustomerServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ lang }, { view }] = await Promise.all([params, searchParams]);
  if (view !== "shipments") {
    redirect(`/${lang}/customer/services?view=shipments`);
  }

  return <CustomerDashboardPage />;
}
