"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ServiceFilters } from "@/features/services/components/ServiceFilters";
import { ServiceTable } from "@/features/services/components/ServiceTable";
import { useServiceStore } from "@/features/services/service.store";
import { getManagerServicesCopy } from "@/features/services/service.copy";

export default function ManagerServicesPage() {
  const { lang } = useParams<{ lang: string }>();
  const copy = getManagerServicesCopy(lang);
  const fetchManagerServices = useServiceStore((state) => state.fetchManagerServices);
  const searchQuery = useServiceStore((state) => state.searchQuery);
  const [page, setPage] = useState(1);
  const resetPageForSearch = useCallback(() => setPage(1), []);
  const pageSize = 20;

  useEffect(() => {
    void fetchManagerServices({ page, pageSize, searchTerm: searchQuery || undefined });
  }, [fetchManagerServices, page, searchQuery]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 font-sans text-slate-800">
      <header>
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          {copy.caseRegister}
        </span>
        <h1 className="mt-1 text-3xl font-semibold text-slate-900">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {copy.subtitle}
        </p>
      </header>

      <div className="space-y-4">
        <ServiceFilters managerView onSearchChange={resetPageForSearch} />
        <ServiceTable managerView onPageChange={setPage} />
      </div>
    </div>
  );
}
