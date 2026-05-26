import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const locales = ["en", "de", "it"] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  it: "Italiano",
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value;
  
  // Validate locale from cookie, fallback to "en"
  const locale = locales.includes(localeCookie as Locale) 
    ? (localeCookie as Locale) 
    : "en";

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Show missing keys visibly during development
    onError(error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[i18n]", error.message);
      }
    },
    getMessageFallback({ namespace, key }) {
      // In development, show missing keys visibly
      if (process.env.NODE_ENV === "development") {
        return `[MISSING: ${namespace}.${key}]`;
      }
      return key;
    },
  };
});
