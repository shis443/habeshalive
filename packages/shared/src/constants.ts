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
