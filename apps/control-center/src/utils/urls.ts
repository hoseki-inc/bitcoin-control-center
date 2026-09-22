export const EXTERNAL_URLS = {
  HOSEKI_APP: import.meta.env.VITE_WEBSITE_URL,
  PRIVACY_POLICY: `${import.meta.env.VITE_WEBSITE_URL}/privacy-policy`,
  TERMS_OF_SERVICE: `${import.meta.env.VITE_WEBSITE_URL}/terms-of-service`,
} as const
