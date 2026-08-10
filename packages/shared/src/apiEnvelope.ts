// The shape every apps/api response is wrapped in (see apps/api/src/app.ts's
// preSerialization hook), except /webhooks/* routes (external providers, not
// our own clients) and non-JSON responses (/metrics, the SVG thumbnail
// placeholder). data is null on failure, error is null on success — never
// both populated, never both null.
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}
