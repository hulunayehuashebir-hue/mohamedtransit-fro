import am from "@/dictionaries/am.json";
import en from "@/dictionaries/en.json";

export type AssessorCopy = typeof en.assessorWorkspace;

export const getAssessorCopy = (locale: string): AssessorCopy =>
  locale === "am" ? am.assessorWorkspace : en.assessorWorkspace;
