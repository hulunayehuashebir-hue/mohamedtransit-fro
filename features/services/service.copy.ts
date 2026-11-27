import am from "@/dictionaries/am.json";
import en from "@/dictionaries/en.json";

export const getManagerServicesCopy = (locale: string) =>
  locale === "am" ? am.managerServices : en.managerServices;

export const getCaseExecutorServicesCopy = (locale: string) =>
  locale === "am" ? am.caseExecutorServices : en.caseExecutorServices;

export const getDataEncoderNavigationCopy = (locale: string) =>
  locale === "am" ? am.dataEncoderNavigation : en.dataEncoderNavigation;
