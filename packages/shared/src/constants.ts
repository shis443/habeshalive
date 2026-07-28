// Single source for both the API's actual charge and the frontend's
// display copy — a price shown to a user before they click and the price
// actually charged must never be able to drift apart.
export const BOOST_PRICE_SANTIM = 5_000; // 50 ETB (100 santim = 1 ETB)
export const BOOST_DURATION_MS = 60 * 60 * 1000; // 1 hour

// Single source for the homepage's category pills and the go-live setup
// form's category dropdown — a category a viewer can filter by and a
// category a creator can pick must always be the same finite set, or
// filtering silently misses streams tagged with a category no pill
// matches.
export const STREAM_CATEGORIES = ["Music", "Gaming", "Traditional", "Just Chatting"] as const;
export type StreamCategory = (typeof STREAM_CATEGORIES)[number];

// Ethiopia's most-used broadcast languages on this platform, plus a
// catch-all — kept as a short fixed list (same reasoning as categories
// above) rather than free text, so the eventual "filter by language"
// feature has a finite set to work with.
export const STREAM_LANGUAGES = ["Amharic", "Oromo", "Tigrinya", "Somali", "English", "Other"] as const;
export type StreamLanguageOption = (typeof STREAM_LANGUAGES)[number];

// VOD retention: 7 days by default, 30 for Anchor Creator Program members —
// real storage cost at scale, not Twitch's 60-day Partner tier, since this
// can be revisited once there's real usage data on what's worth keeping.
export const VOD_RETENTION_DAYS_DEFAULT = 7;
export const VOD_RETENTION_DAYS_ANCHOR = 30;
