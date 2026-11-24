import CustomerServiceDetails from "@/features/customer/components/CustomerServiceDetails";

export default async function CustomerServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerServiceDetails key={id} serviceId={id} />;
}
