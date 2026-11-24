export type EncoderServiceMode = "Multimodal" | "Unimodal";

export const normalizeEncoderServiceMode = (value: unknown): EncoderServiceMode | null => {
	if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
		if (Number(value) === 1) return "Multimodal";
		if (Number(value) === 2) return "Unimodal";
		return null;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized.includes("multi")) return "Multimodal";
		if (normalized.includes("uni")) return "Unimodal";
		return null;
	}

	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

	const record = value as Record<string, unknown>;
	for (const name of [
		"name",
		"label",
		"mode",
		"transportMode",
		"transportModeName",
		"serviceType",
		"serviceTypeName",
		"value",
		"code",
		"transportModeId",
		"serviceTypeId",
		"id",
	]) {
		const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
		if (!key) continue;
		const mode = normalizeEncoderServiceMode(record[key]);
		if (mode) return mode;
	}

	return null;
};
