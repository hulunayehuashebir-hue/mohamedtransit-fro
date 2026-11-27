"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useServiceStore } from "../service.store";
import { Search, Filter, Columns, Download } from "lucide-react";
import type { ServiceColumn, ServiceRecord } from "../service.types";
import { getManagerServicesCopy } from "../service.copy";

const columnOptions: Array<{ key: ServiceColumn; label: string }> = [
  { key: "service", label: "Service" },
  { key: "importer", label: "Importer" },
  { key: "mode", label: "Mode" },
  { key: "status", label: "Status" },
  { key: "risk", label: "Risk" },
  { key: "caseExecutor", label: "Case executor" },
  { key: "eta", label: "ETA" },
  { key: "sla", label: "SLA" },
  { key: "updated", label: "Updated" },
];

const exportColumns: Array<{ label: string; value: (service: ServiceRecord) => string }> = [
  { label: "Service", value: (service) => service.serviceCode ?? service.referenceNumber ?? "Service reference unavailable" },
  { label: "Reference", value: (service) => service.referenceNumber ?? "" },
  { label: "Title", value: (service) => service.title },
  { label: "Importer", value: (service) => service.importerName },
  { label: "Importer code", value: (service) => service.importerCode },
  { label: "Mode", value: (service) => service.mode },
  { label: "Status", value: (service) => service.status },
  { label: "Risk", value: (service) => service.riskChannel },
  { label: "Case executor", value: (service) => service.caseExecutor },
  { label: "ETA", value: (service) => service.eta },
  { label: "SLA", value: (service) => service.sla },
  { label: "Updated", value: (service) => service.updated },
];

export function ServiceFilters({
  managerView = false,
  onSearchChange,
}: {
  managerView?: boolean;
  embedded?: boolean;
  onSearchChange?: () => void;
}) {
  const { lang } = useParams<{ lang: string }>();
  const copy = getManagerServicesCopy(lang);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const selectableColumns = managerView
    ? columnOptions.filter(({ key }) => key !== "service" && key !== "importer")
    : columnOptions;
  const {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    modeFilter,
    setModeFilter,
    channelFilter,
    setChannelFilter,
    visibleColumns,
    toggleColumn,
    getFilteredServices,
  } = useServiceStore();
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    if (searchInput.trim() === searchQuery) return;
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      onSearchChange?.();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [onSearchChange, searchInput, searchQuery, setSearchQuery]);

  const exportServices = async () => {
    const rows = getFilteredServices();
    const quoteCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csvRows = [
      exportColumns.map(({ label }) => label),
      ...rows.map((service) => exportColumns.map(({ value }) => value(service))),
    ];
    const blob = new Blob(
      [`\uFEFF${csvRows.map((row) => row.map(quoteCsv).join(",")).join("\r\n")}`],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = managerView ? "manager-services.csv" : "services.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={`flex flex-col items-center justify-between gap-3 border border-slate-200 bg-white p-4 shadow-sm lg:flex-row ${managerView ? "rounded-lg" : "rounded-xl"}`}>
      {/* Search Input & Select Dropdowns */}
      <div className={`grid w-full flex-1 items-center gap-2 lg:w-auto ${managerView ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1.35fr)_repeat(3,minmax(125px,1fr))]" : "flex flex-wrap"}`}>
        <div className={`relative flex-1 ${managerView ? "min-w-0" : "min-w-65 lg:flex-initial"}`}>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            aria-label="Search services"
            placeholder={managerView ? copy.searchPlaceholder : "Search by service ID, reference, commodity or importer"}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={`w-full border border-slate-200 py-2 pl-9 pr-3 text-slate-800 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500 ${managerView ? "min-h-10 rounded-md text-sm" : "rounded-lg text-xs"}`}
          />
        </div>

        {/* Status Dropdown */}
        <div className="relative">
          <select
            aria-label="Filter services by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`appearance-none border border-slate-200 bg-white py-2 pl-8 pr-8 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 ${managerView ? "min-h-10 w-full rounded-md text-sm" : "cursor-pointer rounded-lg text-xs"}`}
          >
            <option value="ALL">{managerView ? copy.allStatuses : "All statuses"}</option>
            {(managerView
              ? ["In progress", "Needs review", "Requires customer action", "Pending", "Completed", "Blocked"]
              : ["Draft", "Submitted", "Under review", "Approved", "In progress", "Needs review", "Requires customer action", "Pending", "Blocked", "Completed", "Rejected", "Cancelled", "Delivered"]
            ).map((status) => (
              <option key={status} value={status}>
                {managerView ? copy.statuses[status as keyof typeof copy.statuses] : status}
              </option>
            ))}
          </select>
          <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
        </div>

        {/* Mode Dropdown */}
        <select
          aria-label="Filter services by transport mode"
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          className={`border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 ${managerView ? "min-h-10 w-full rounded-md text-sm" : "cursor-pointer rounded-lg text-xs"}`}
        >
          <option value="ALL">{managerView ? copy.allModes : "All modes"}</option>
          <option value="Unimodal">{managerView ? copy.unimodal : "Unimodal"}</option>
          <option value="Multimodal">{managerView ? copy.multimodal : "Multimodal"}</option>
        </select>

        {/* Channels Dropdown */}
        <select
          aria-label="Filter services by risk channel"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className={`border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 ${managerView ? "min-h-10 w-full rounded-md text-sm" : "cursor-pointer rounded-lg text-xs"}`}
        >
          <option value="ALL">{managerView ? copy.allChannels : "All channels"}</option>
          {(["Green channel", "Yellow channel", "Blue channel", "Red channel"] as const).map((channel) => (
            <option key={channel} value={channel}>
              {managerView ? copy.channels[channel] : channel}
            </option>
          ))}
        </select>
      </div>

      <div className={`flex w-full items-center justify-end gap-2 lg:w-auto ${managerView ? "shrink-0" : ""}`}>
        <div className="relative">
          <button
            type="button"
            aria-controls="service-column-options"
            aria-label="Choose visible service columns"
            aria-expanded={columnsOpen}
            onClick={() => setColumnsOpen((open) => !open)}
            className={`flex min-h-10 items-center gap-1.5 border border-slate-200 px-3 py-2 font-semibold text-slate-700 transition-colors hover:bg-slate-50 ${managerView ? "rounded-md text-sm" : "rounded-lg text-xs"}`}
          >
            <Columns className="w-3.5 h-3.5 text-slate-500" />
            {managerView ? copy.columns : "Columns"}
          </button>
          {columnsOpen && (
            <div id="service-column-options" className="absolute right-0 top-full z-20 mt-2 min-w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              {selectableColumns.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(key)}
                    onChange={() => toggleColumn(key)}
                    className="accent-blue-600"
                  />
                  {managerView ? copy[key] : label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Export filtered services as CSV"
          onClick={exportServices}
          className={`flex min-h-10 items-center gap-1.5 border border-slate-200 px-3 py-2 font-semibold text-slate-700 transition-colors hover:bg-slate-50 ${managerView ? "rounded-md text-sm" : "rounded-lg text-xs"}`}
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          {managerView ? copy.export : "Export"}
        </button>
      </div>
    </div>
  );
}