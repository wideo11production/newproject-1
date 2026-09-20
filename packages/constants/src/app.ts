export const APP_NAME = "Wideo11";
export const APP_URL = "https://wideo11.com";
export const APP_API_URL = "https://api.wideo11.com";
export const APP_AUTH_URL = "https://auth.wideo11.com";
export const APP_EDITOR_URL = "https://editor.wideo11.com";
export const APP_ADMIN_URL = "https://admin.wideo11.com";
export const APP_ADS_URL = "https://ads.wideo11.com";
export const APP_MONITOR_URL = "https://monitor.wideo11.com";
export const APP_CDN_URL = "https://cdn.wideo11.com";

export const APP_DESCRIPTION = "Your Video Platform";
export const APP_KEYWORDS = ["video", "streaming", "creator", "editor", "monetization"];

export const DEFAULT_LANGUAGE = "en";
export const SUPPORTED_LANGUAGES = ["en", "hi", "es", "fr", "de", "ja", "ko", "zh"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_TIMEZONE = "UTC";
export const SUPPORTED_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;