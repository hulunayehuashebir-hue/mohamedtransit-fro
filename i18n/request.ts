import { defaultLocale, isLocale, type Locale } from "./routing";

export function getRequestLocale(
  acceptLanguage: string | null,
  cookieLocale?: string | null,
): Locale {
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;
  if (!acceptLanguage) return defaultLocale;

  const preferences = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [language, ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const quality = qualityParameter
        ? Number(qualityParameter.trim().slice(2))
        : 1;

      return {
        language: language.toLowerCase().split("-")[0],
        quality,
        index,
      };
    })
    .filter(
      (preference) =>
        preference.quality > 0 &&
        preference.quality <= 1 &&
        Number.isFinite(preference.quality),
    )
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const preference of preferences) {
    if (isLocale(preference.language)) return preference.language;
  }

  return defaultLocale;
}

export async function getDictionary(locale: Locale) {
  return locale === "am"
    ? (await import("../dictionaries/am.json")).default
    : (await import("../dictionaries/en.json")).default;
}
