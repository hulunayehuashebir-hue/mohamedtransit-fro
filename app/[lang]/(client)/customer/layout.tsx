import type { ReactNode } from "react";
import { Suspense } from "react";
import { CustomerShell } from "@/features/customer/components/CustomerShell";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div role="status" className="p-6 text-sm text-slate-500">Loading customer workspace...</div>}>
      <CustomerShell>{children}</CustomerShell>
    </Suspense>
  );
}
