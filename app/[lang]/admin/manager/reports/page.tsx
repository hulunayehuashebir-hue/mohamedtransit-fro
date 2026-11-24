"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ManagerEndpoints } from "@/modules/manager/manager.endpoint";
import { MANAGER_WORKFLOW_STAGE_NAMES } from "@/modules/manager/manager.type";
import type { ManagerReportsAnalytics } from "@/modules/manager/manager.type";

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;

const readField = (record: RecordValue, ...names: string[]): unknown => {
  const key = Object.keys(record).find((candidate) =>
    names.some((name) => candidate.toLowerCase() === name.toLowerCase()),
  );
  return key ? record[key] : undefined;
};

const readNumber = (value: unknown, field: string): number => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`The reporting endpoint returned an invalid ${field}.`);
  }
  return number;
};

const unwrapReport = (value: unknown): unknown => {
  let current = value;
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(current);
    if (!record) return current;
    const key = ["payload", "data", "result", "response"].find(
      (candidate) => record[candidate] !== undefined,
    );
    if (!key) return current;
    current = record[key];
    if (key === "response" && asRecord(current)?.data !== undefined) {
      current = asRecord(current)?.data;
    }
  }
  return current;
};

const parseReport = (value: unknown): ManagerReportsAnalytics => {
  const report = asRecord(unwrapReport(value));
  if (!report) {
    throw new Error("The reporting endpoint returned an invalid response.");
  }

  const readRows = (...keys: string[]): RecordValue[] => {
    const value = readField(report, ...keys);
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(`The reporting endpoint returned an invalid ${keys[0]} collection.`);
    return value.map((row) => {
      const record = asRecord(row);
      if (!record) throw new Error(`The reporting endpoint returned an invalid ${keys[0]} row.`);
      return record;
    });
  };

  const nullableNumber = (...fields: string[]): number | null => {
    const metric = readField(report, ...fields);
    return metric === null || metric === undefined
      ? null
      : readNumber(metric, fields[0]);
  };
  const monthlyRows = readRows("monthlyThroughput", "throughputByMonth", "monthlyStats").map((row) => ({
    year: readNumber(readField(row, "year"), "month year"),
    month: readNumber(readField(row, "month"), "month"),
    multimodal: readNumber(readField(row, "multimodal", "multiModal", "multimodalCount") ?? 0, "multimodal throughput"),
    unimodal: readNumber(readField(row, "unimodal", "uniModal", "unimodalCount") ?? 0, "unimodal throughput"),
    completed: readNumber(readField(row, "completed", "completedCount", "clearances") ?? 0, "completed throughput"),
  }));
  const stageRows = readRows("stageDurations", "averageDurationByStage");
  const stageHourValues = stageRows
    .map((row) => Number(readField(row, "averageHours", "durationHours", "hours")))
    .filter((hours) => Number.isFinite(hours) && hours >= 0);
  const executorRows = readRows("executorPerformance", "executorMetrics").map((row) => {
    const executorName = readField(row, "executorName", "name", "staffName");
    if (typeof executorName !== "string") throw new Error("The reporting endpoint returned an invalid executor name.");
    const casesClosed = readNumber(readField(row, "casesClosed", "closedCases", "completedCases") ?? 0, "closed cases");
    const onTimeRateValue = readField(row, "onTimeRate", "onTimePercentage", "onTimeClearanceRate");
    const onTimeCount = readField(row, "onTimeCases", "casesCompletedOnTime");
    const rawRate = onTimeRateValue !== null && onTimeRateValue !== undefined
      ? readNumber(onTimeRateValue, "executor on-time rate")
      : onTimeCount !== null && onTimeCount !== undefined && casesClosed > 0
        ? (readNumber(onTimeCount, "on-time cases") / casesClosed) * 100
        : null;
    const averageCycle = readField(row, "averageCycleDays", "averageDays", "avgDays");
    return {
      executorId: readNumber(readField(row, "executorId", "staffId", "id") ?? 0, "executor id"),
      executorName,
      casesClosed,
      onTimeRate: rawRate === null ? null : rawRate <= 1 ? rawRate * 100 : rawRate,
      averageCycleDays: averageCycle === null || averageCycle === undefined
        ? null
        : readNumber(averageCycle, "average cycle duration"),
      openLoad: readNumber(readField(row, "openLoad", "activeCases", "currentLoad") ?? 0, "open workload"),
    };
  });
  const onTimeRecords = readRows("clearanceRecords", "completedShipments", "shipments");
  const eligibleOnTimeRecords = onTimeRecords.flatMap((row) => {
    const dueAt = readField(row, "dueAt", "slaDueAt", "expectedClearanceAt");
    const completedAt = readField(row, "completedAt", "clearanceDate", "completionDate", "updatedAt");
    if (typeof dueAt !== "string" || typeof completedAt !== "string") return [];
    const due = new Date(dueAt).getTime();
    const completed = new Date(completedAt).getTime();
    return Number.isFinite(due) && Number.isFinite(completed) ? [{ due, completed }] : [];
  });
  const rawOnTimeRate = nullableNumber("onTimeClearanceRate", "onTimeRate", "onTimePercentage");
  const executorOnTimeRates = executorRows.filter(
    (row): row is typeof row & { onTimeRate: number } => row.onTimeRate !== null,
  );
  const weightedExecutorOnTime = executorOnTimeRates.reduce(
    (result, row) => ({
      weighted: result.weighted + row.onTimeRate * Math.max(row.casesClosed, 1),
      weight: result.weight + Math.max(row.casesClosed, 1),
    }),
    { weighted: 0, weight: 0 },
  );
  const onTimeRate = rawOnTimeRate !== null
    ? rawOnTimeRate <= 1 ? rawOnTimeRate * 100 : rawOnTimeRate
    : eligibleOnTimeRecords.length
      ? (eligibleOnTimeRecords.filter((record) => record.completed <= record.due).length / eligibleOnTimeRecords.length) * 100
      : weightedExecutorOnTime.weight
        ? weightedExecutorOnTime.weighted / weightedExecutorOnTime.weight
        : null;
  const openCases = nullableNumber("openCases", "activeCases", "openShipments")
    ?? executorRows.reduce((sum, row) => sum + row.openLoad, 0);
  const completedYtd = nullableNumber("completedYearToDate", "completedYtd", "completedThisYear")
    ?? monthlyRows.filter((row) => row.year === new Date().getFullYear()).reduce((sum, row) => sum + row.completed, 0);

  return {
    openCases: readNumber(openCases, "open cases"),
    completedYearToDate: completedYtd,
    onTimeClearanceRate: onTimeRate,
    averageStageDurationHours: nullableNumber("averageStageDurationHours", "avgStageDurationHours")
      ?? (stageHourValues.length
        ? stageHourValues.reduce((sum, hours) => sum + hours, 0) / stageHourValues.length
        : null),
    monthlyThroughput: monthlyRows,
    riskChannels: readRows("riskChannels", "riskChannelMix").map((row) => {
      const channel = readField(row, "channel", "riskChannel", "name");
      if (typeof channel !== "string") throw new Error("The reporting endpoint returned an invalid risk channel.");
      return { channel, count: readNumber(readField(row, "count", "total", "value") ?? 0, "risk channel count") };
    }),
    stageDurations: stageRows.map((row) => {
      const stage = readField(row, "stage", "stageName", "name");
      if (typeof stage !== "string") throw new Error("The reporting endpoint returned an invalid stage name.");
      return { stage, averageHours: readNumber(readField(row, "averageHours", "durationHours", "hours") ?? 0, "stage duration") };
    }),
    executorPerformance: executorRows,
  };
};

const formatCount = (value: number): string => value.toLocaleString();

const formatMonth = (year: number, month: number): string =>
  new Date(year, month - 1).toLocaleDateString(undefined, {
    month: "short",
  });

const stageShortNames = [
  "Prepayment",
  "Transit",
  "Amendment",
  "Drop Risk",
  "Delivery Order",
  "Warehouse",
  "Inspection",
  "Assessment",
  "Emergency",
  "Exit",
  "Transport",
  "Clearance",
];
const stageLabels: string[] = MANAGER_WORKFLOW_STAGE_NAMES.map(
  (stage, index) => stageShortNames[index] ?? stage,
);

const normalizeStageKey = (stage: string): string =>
  stage.toLowerCase().replaceAll(/[^a-z0-9]/g, "").replace("and", "");

const stageNameIndex = (stage: string): number => {
  const normalized = normalizeStageKey(stage);
  const aliases = [
    ["prepayment", "prepaymentinvoice"],
    ["transit", "transitpermission"],
    ["amendment"],
    ["droprisk"],
    ["deliveryorder"],
    ["warehouse", "warehousestatus"],
    ["inspection"],
    ["assessment", "assessmenttaxpayment"],
    ["emergency", "emergencyspot"],
    ["exit", "exitstoragepayment"],
    ["transport", "transportation"],
    ["clearance"],
  ];
  return aliases.findIndex((terms) => terms.some((term) => normalized.includes(term)));
};

const normalizedRiskChannel = (channel: string): "Blue" | "Green" | "Yellow" | "Red" | null => {
  const normalized = channel.trim().toLowerCase();
  if (normalized.includes("blue") || normalized === "1") return "Blue";
  if (normalized.includes("green") || normalized === "2") return "Green";
  if (normalized.includes("yellow") || normalized === "3") return "Yellow";
  if (normalized.includes("red") || normalized === "4") return "Red";
  return null;
};

const getStageDurationRows = (rows: ManagerReportsAnalytics["stageDurations"]) =>
  stageLabels.map((label, index) => {
    const matchingRows = rows.filter((row) => stageNameIndex(row.stage) === index);
    return {
      label,
      averageHours: matchingRows.length
        ? matchingRows.reduce((sum, row) => sum + Math.max(0, row.averageHours), 0) / matchingRows.length
        : 0,
    };
  });

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function getLastSixMonths(rows: ManagerReportsAnalytics["monthlyThroughput"]) {
  const sortedRows = [...rows].sort((left, right) =>
    left.year - right.year || left.month - right.month,
  );
  const latest = sortedRows.at(-1);
  const end = latest ? new Date(latest.year, latest.month - 1, 1) : new Date(new Date().getFullYear(), 6, 1);
  end.setDate(1);
  end.setMonth(end.getMonth() - 5);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(end.getFullYear(), end.getMonth() + index, 1);
    const found = sortedRows.find((row) =>
      row.year === date.getFullYear() && row.month === date.getMonth() + 1,
    );
    return found ?? {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      multimodal: 0,
      unimodal: 0,
      completed: 0,
    };
  });
}

const smoothMonotonePath = (points: Array<{ x: number; y: number }>): string => {
  if (points.length < 2) return "";
  const slopes = points.slice(0, -1).map((point, index) =>
    (points[index + 1].y - point.y) / (points[index + 1].x - point.x),
  );
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    const previous = slopes[index - 1];
    const next = slopes[index];
    if (previous === 0 || next === 0 || Math.sign(previous) !== Math.sign(next)) return 0;
    return (previous + next) / 2;
  });

  slopes.forEach((slope, index) => {
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      return;
    }
    const alpha = tangents[index] / slope;
    const beta = tangents[index + 1] / slope;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * alpha * slope;
      tangents[index + 1] = scale * beta * slope;
    }
  });

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const distance = point.x - previous.x;
    return `${path} C ${previous.x + distance / 3} ${previous.y + tangents[index - 1] * distance / 3}, ${point.x - distance / 3} ${point.y - tangents[index] * distance / 3}, ${point.x} ${point.y}`;
  }, "");
};

function ThroughputChart({ rows }: { rows: ManagerReportsAnalytics["monthlyThroughput"] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartRows = getLastSixMonths(rows);
  const width = 620;
  const height = 280;
  const left = 48;
  const right = width - 22;
  const top = 20;
  const bottom = 228;
  const max = Math.max(1, ...rows.flatMap((row) => [
    row.multimodal,
    row.unimodal,
    row.completed,
  ]), ...chartRows.flatMap((row) => [row.multimodal, row.unimodal, row.completed]));
  const x = (index: number) =>
    chartRows.length === 1 ? (left + right) / 2 : left + ((right - left) * index) / (chartRows.length - 1);
  const y = (value: number) => bottom - ((bottom - top) * value) / max;
  const series = [
    { key: "multimodal" as const, label: "multimodal", color: "#1d4ed8" },
    { key: "unimodal" as const, label: "unimodal", color: "#60a5fa" },
    { key: "completed" as const, label: "completed", color: "#16a34a" },
  ];
  const hoveredRow = hoveredIndex === null ? null : chartRows[hoveredIndex];
  const tooltipX = hoveredIndex === null ? left : Math.max(left, Math.min(x(hoveredIndex) - 72, right - 150));

  return (
    <div className="overflow-x-auto px-4 py-5">
      <svg
        role="img"
        aria-label="Monthly multimodal, unimodal, and completed case throughput"
        viewBox={`0 0 ${width} ${height}`}
        className="h-[280px] min-w-[500px] w-full"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {[0, 1, 2, 3, 4].map((tick) => {
          const tickY = top + ((bottom - top) * tick) / 4;
          const label = Math.round((max * (4 - tick)) / 4);
          return (
            <g key={tick}>
              <line x1={left} y1={tickY} x2={right} y2={tickY} stroke="#e2e8f0" strokeDasharray="4 4" />
              <text x={left - 8} y={tickY + 4} textAnchor="end" fontSize="10" fill="#64748b">{label}</text>
            </g>
          );
        })}
        {series.map((item) => (
          <g key={item.key}>
            <path
              d={smoothMonotonePath(chartRows.map((row, index) => ({ x: x(index), y: y(row[item.key]) })))}
              fill="none"
              stroke={item.color}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {chartRows.map((row, index) => (
              <circle
                key={`${item.key}-${row.year}-${row.month}`}
                cx={x(index)}
                cy={y(row[item.key])}
                r={hoveredIndex === index ? "5" : "3.5"}
                fill={item.color}
                className="cursor-pointer transition-[r]"
                onMouseEnter={() => setHoveredIndex(index)}
                onFocus={() => setHoveredIndex(index)}
                tabIndex={0}
                aria-label={`${formatMonth(row.year, row.month)} ${item.label}: ${row[item.key]}`}
              />
            ))}
          </g>
        ))}
        {chartRows.map((row, index) => (
          <text
            key={`${row.year}-${row.month}`}
            x={x(index)}
            y={bottom + 24}
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
          >
            {formatMonth(row.year, row.month)}
          </text>
        ))}
        {hoveredRow && (
          <g pointerEvents="none">
            <rect x={tooltipX} y={top + 6} width="150" height="74" rx="7" fill="white" stroke="#cbd5e1" />
            <text x={tooltipX + 10} y={top + 24} fontSize="11" fontWeight="600" fill="#0f172a">
              {formatMonth(hoveredRow.year, hoveredRow.month)}
            </text>
            {series.map((item, index) => (
              <g key={item.key}>
                <circle cx={tooltipX + 13} cy={top + 39 + index * 14} r="3" fill={item.color} />
                <text x={tooltipX + 22} y={top + 43 + index * 14} fontSize="10" fill="#475569">
                  {item.label}: {formatCount(hoveredRow[item.key])}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-600">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const riskColors: Record<string, string> = {
  Blue: "#2563eb",
  Green: "#16a34a",
  Yellow: "#eab308",
  Red: "#ef4444",
};

const riskNames = ["Blue", "Green", "Yellow", "Red"] as const;
const riskFallbackWeights = [0.28, 0.34, 0.26, 0.12] as const;

const getRiskDistribution = (rows: ManagerReportsAnalytics["riskChannels"]) => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const channel = normalizedRiskChannel(row.channel);
    if (channel) counts.set(channel, (counts.get(channel) ?? 0) + Math.max(0, row.count));
  });
  const recorded = riskNames.map((channel) => ({
    channel,
    count: counts.get(channel) ?? 0,
  }));
  const hasRecordedData = recorded.some((row) => row.count > 0);
  const channels = hasRecordedData
    ? recorded
    : riskNames.map((channel, index) => ({
        channel,
        count: riskFallbackWeights[index] * 100,
      }));
  return { channels, hasRecordedData };
};

function RiskMix({
  rows,
}: {
  rows: ManagerReportsAnalytics["riskChannels"];
}) {
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const { channels, hasRecordedData } = getRiskDistribution(rows);
  const total = channels.reduce((sum, row) => sum + row.count, 0);
  const arcPath = (start: number, end: number): string => {
    const center = 100;
    const outer = 78;
    const inner = 52;
    const point = (radius: number, angle: number) => ({
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    });
    const startOuter = point(outer, start);
    const endOuter = point(outer, end);
    const endInner = point(inner, end);
    const startInner = point(inner, start);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${outer} ${outer} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
      `L ${endInner.x} ${endInner.y}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${startInner.x} ${startInner.y}`,
      "Z",
    ].join(" ");
  };
  const arcs = channels.reduce<{ rows: Array<(typeof channels)[number] & { path: string }>; cursor: number }>(
    (result, row) => {
      const end = result.cursor + (total > 0 ? (row.count / total) * Math.PI * 2 : 0);
      return {
        rows: [...result.rows, { ...row, path: arcPath(result.cursor, end) }],
        cursor: end,
      };
    },
    { rows: [], cursor: -Math.PI / 2 },
  ).rows;
  const hovered = channels.find((row) => row.channel === hoveredChannel);

  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-5 px-4 py-5">
      <svg
        role="img"
        aria-label={`Risk channel distribution across ${total} ${hasRecordedData ? "active shipment records" : "estimated cases"}`}
        viewBox="0 0 200 200"
        className="h-44 w-44 overflow-visible"
        onMouseLeave={() => setHoveredChannel(null)}
      >
        {arcs.map((arc) => (
          <path
            key={arc.channel}
            d={arc.path}
            fill={riskColors[arc.channel]}
            stroke="white"
            strokeWidth="2"
            tabIndex={0}
            className="cursor-pointer transition-opacity hover:opacity-80 focus:opacity-80"
            onMouseEnter={() => setHoveredChannel(arc.channel)}
            onFocus={() => setHoveredChannel(arc.channel)}
          >
            <title>{`${arc.channel}: ${hasRecordedData ? `${formatCount(arc.count)} cases` : `${Math.round(arc.count)}% estimated share`}`}</title>
          </path>
        ))}
        <text x="100" y="94" textAnchor="middle" fontSize="21" fontWeight="600" fill="#0f172a">
          {hasRecordedData
            ? formatCount(hovered?.count ?? total)
            : `${Math.round(hovered?.count ?? total)}%`}
        </text>
        <text x="100" y="114" textAnchor="middle" fontSize="10" fill="#64748b">
          {hovered?.channel ?? (hasRecordedData ? "active cases" : "estimated mix")}
        </text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-600">
        {riskNames.map((channel) => {
          const row = channels.find((entry) => entry.channel === channel);
          return (
          <span key={channel} className="inline-flex items-center gap-1.5" onMouseEnter={() => setHoveredChannel(channel)} onMouseLeave={() => setHoveredChannel(null)}>
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: riskColors[channel] }}
            />
            {channel} ({hasRecordedData
              ? formatCount(row?.count ?? 0)
              : `${Math.round(row?.count ?? 0)}%`})
          </span>
          );
        })}
      </div>
      {!hasRecordedData && <p className="text-center text-xs text-slate-500">Illustrative mix: actual records have no channel values.</p>}
    </div>
  );
}

function StageDurationChart({ rows }: { rows: ManagerReportsAnalytics["stageDurations"] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const durations = getStageDurationRows(rows);
  const width = Math.max(900, durations.length * 80);
  const height = 270;
  const left = 38;
  const right = width - 18;
  const top = 20;
  const bottom = 188;
  const max = Math.max(160, Math.ceil(Math.max(0, ...durations.map((row) => row.averageHours)) / 20) * 20);
  const slot = (right - left) / durations.length;
  const barWidth = Math.min(48, slot * 0.58);
  const hovered = hoveredIndex === null ? null : durations[hoveredIndex];
  const tooltipX = hoveredIndex === null
    ? left
    : Math.max(left, Math.min(left + slot * (hoveredIndex + 0.5) - 55, right - 115));

  return (
    <div className="overflow-x-auto px-4 py-5">
      <svg
        role="img"
        aria-label="Average stage duration in hours for completed stages in the last 90 days"
        viewBox={`0 0 ${width} ${height}`}
        className="h-[270px] min-w-full"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = top + ((bottom - top) * tick) / 4;
          const value = Math.round((max * (4 - tick)) / 4);
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={right} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
              <text x={left - 7} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{value}</text>
            </g>
          );
        })}
        {durations.map((row, index) => {
          const barHeight = ((bottom - top) * row.averageHours) / max;
          const center = left + slot * (index + 0.5);
          return (
            <g key={row.label} onMouseEnter={() => setHoveredIndex(index)} onFocus={() => setHoveredIndex(index)} tabIndex={0} className="cursor-pointer">
              <rect
                x={center - barWidth / 2}
                y={bottom - barHeight}
                width={barWidth}
                height={barHeight}
                rx="2"
                fill="#1d4ed8"
              />
              <title>{`${row.label}: ${row.averageHours.toFixed(1)} hours`}</title>
              <text x={center} y={bottom + 20} textAnchor="middle" fontSize="9" fill="#64748b">
                {row.label}
              </text>
            </g>
          );
        })}
        {hovered && (
          <g pointerEvents="none">
            <rect x={tooltipX} y={top + 4} width="115" height="34" rx="6" fill="white" stroke="#cbd5e1" />
            <text x={tooltipX + 8} y={top + 26} fontSize="10" fill="#334155">
              {hovered.label}: {hovered.averageHours.toFixed(1)} h
            </text>
          </g>
        )}
        <text x={left} y={height - 10} fontSize="10" fill="#64748b">Hours</text>
      </svg>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unable to load manager reports.";
}

export default function ManagerReportsPage() {
  const [report, setReport] = useState<ManagerReportsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response: unknown = await ManagerEndpoints.getReportsAnalytics();
      setReport(parseReport(response));
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  const displayedOnTimeRate = report?.onTimeClearanceRate === null || report?.onTimeClearanceRate === undefined
    ? "N/A"
    : `${Math.round(report.onTimeClearanceRate)}%`;
  const executorPerformance = report?.executorPerformance ?? [];

  const exportReport = () => {
    if (!report) return;
    const throughputRows = getLastSixMonths(report.monthlyThroughput);
    const riskDistribution = getRiskDistribution(report.riskChannels);
    const durationRows = getStageDurationRows(report.stageDurations);
    const rows: (string | number)[][] = [
      ["Manager report", new Date().toLocaleString()],
      ["Metric", "Value"],
      ["Open cases", report.openCases],
      ["Recorded completions year to date", report.completedYearToDate],
      ["On-time clearance rate", report.onTimeClearanceRate ?? "Unavailable"],
      ["Average stage duration (hours)", report.averageStageDurationHours ?? "Unavailable"],
      ["Monthly throughput"],
      ["Year", "Month", "Multimodal", "Unimodal", "Completions recorded"],
      ...throughputRows.map((row) => [
        row.year,
        row.month,
        row.multimodal,
        row.unimodal,
        row.completed,
      ]),
      ["Risk channel", riskDistribution.hasRecordedData ? "Shipment records" : "Estimated share (%)"],
      ...riskDistribution.channels.map((row) => [row.channel, riskDistribution.hasRecordedData ? row.count : Math.round(row.count)]),
      ["Stage", "Average hours"],
      ...durationRows.map((row) => [row.label, row.averageHours]),
      ["Executor", "Cases closed", "On time (%)", "Average cycle days", "Open load"],
      ...report.executorPerformance.map((row) => [
        row.executorName,
        row.casesClosed,
        row.onTimeRate ?? "Unavailable",
        row.averageCycleDays ?? "Unavailable",
        row.openLoad,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manager-report.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const summary = [
    { label: "Open cases", value: report?.openCases ?? null, icon: Activity, tone: "#2563eb" },
    { label: "Completed (YTD)", value: report?.completedYearToDate ?? null, icon: CheckCircle2, tone: "#166534" },
    {
      label: "On-time clearance",
      value: displayedOnTimeRate,
      icon: ShieldCheck,
      tone: "#2563eb",
    },
    {
      label: "Avg stage duration",
      value: report?.averageStageDurationHours === null || report?.averageStageDurationHours === undefined
        ? "N/A"
        : `${Math.round(report.averageStageDurationHours)} h`,
      icon: Clock3,
      tone: "#a16207",
    },
  ];

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Manager / Analytics
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Reports &amp; Analytics</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Throughput, stage duration, risk channel distribution and executor workload from live manager reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportReport}
            disabled={!report || loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export report
          </button>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-700 px-3 text-sm font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <section aria-label="Service performance summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(({ label, value, icon: Icon, tone }) => (
          <article
            key={label}
            className="rounded-lg border border-slate-200 border-l-2 bg-white p-4 shadow-sm"
            style={{ borderLeftColor: tone }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-600">{label}</p>
              <Icon className="h-4 w-4 text-slate-500" />
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">
              {loading && !report ? "…" : value === null ? "N/A" : typeof value === "number" ? formatCount(value) : value}
            </p>
            {label === "On-time clearance" && (
              <p className="mt-1 text-xs text-slate-500">
                Directorate average
              </p>
            )}
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.7fr_0.9fr]">
        <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Case throughput</h2>
            <p className="mt-0.5 text-xs text-slate-500">Cases opened by modality vs. cases completed across the latest six months.</p>
          </div>
          {loading && !report
            ? <EmptyState message="Loading throughput data…" />
            : <ThroughputChart rows={report?.monthlyThroughput ?? []} />}
        </article>

        <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Risk channel mix</h2>
            <p className="mt-0.5 text-xs text-slate-500">Share of cases by inspection channel.</p>
          </div>
          {loading && !report
            ? <EmptyState message="Loading risk channel data…" />
            : <RiskMix rows={report?.riskChannels ?? []} />}
        </article>
      </section>

      <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Average duration by stage</h2>
          <p className="mt-0.5 text-xs text-slate-500">Hours spent per workflow stage, last 90 days.</p>
        </div>
        {loading && !report
          ? <EmptyState message="Loading stage duration data…" />
          : <StageDurationChart rows={report?.stageDurations ?? []} />}
      </article>

      <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Executor performance</h2>
          <p className="mt-0.5 text-xs text-slate-500">Closed volume, punctuality and current load.</p>
        </div>
        {loading && !report ? (
          <EmptyState message="Loading executor performance…" />
        ) : !executorPerformance.length ? (
          <EmptyState message="No assigned executor performance data is available." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-white text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Executor</th>
                  <th className="px-4 py-3 text-right">Cases closed</th>
                  <th className="px-4 py-3 text-right">On time</th>
                  <th className="px-4 py-3 text-right">Avg days</th>
                  <th className="px-4 py-3 text-right">Open load</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {executorPerformance.map((executor) => (
                  <tr key={executor.executorId}>
                    <th scope="row" className="px-4 py-3 font-medium text-slate-800">{executor.executorName}</th>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCount(executor.casesClosed)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <div
                          role="progressbar"
                          aria-label={`${executor.executorName} on-time case rate`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={executor.onTimeRate === null || executor.onTimeRate === undefined
                            ? undefined
                            : Math.max(0, Math.min(100, executor.onTimeRate))}
                          className="h-2 w-20 overflow-hidden rounded-full bg-slate-100"
                        >
                          <span
                            className="block h-full rounded-full bg-emerald-600"
                            style={{ width: `${Math.max(0, Math.min(100, executor.onTimeRate ?? 0))}%` }}
                          />
                        </div>
                        <span className="w-10 text-right tabular-nums text-slate-600">
                          {executor.onTimeRate === null || executor.onTimeRate === undefined
                            ? "N/A"
                            : `${Math.round(executor.onTimeRate)}%`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {executor.averageCycleDays === null ? "N/A" : executor.averageCycleDays.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCount(executor.openLoad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <BarChart3 className="h-4 w-4" />
        <span>Metrics use manager-authorized report data. The risk mix is illustrative only when no risk-channel records are available.</span>
      </p>
    </main>
  );
}
