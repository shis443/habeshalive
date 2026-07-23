// Starter blocklists for apps/api/src/moderation/service.ts's flag-for-review
// scan. These are intentionally small illustrative seed lists, not
// exhaustive moderation lists — a real deployment should have these
// reviewed and expanded by an actual trust & safety team, not treat this
// file as complete.
//
// EN_BLOCKLIST: a handful of common English profanity terms, enough to
// prove the flagging mechanism works end-to-end.
//
// AM_BLOCKLIST is deliberately empty. A credible open-source multilingual
// profanity list was checked before writing this file
// (LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words, 28
// languages) and it has no Amharic list. Rather than invent Amharic
// slurs/harassment terms from memory — which risks being wrong,
// nonsensical, or actively offensive in ways a non-native speaker can't
// self-check — this ships empty with real infrastructure around it
// (scanText, the queue, the admin review endpoints all work today for
// English) so a native-speaker-reviewed list can be dropped in later
// without touching any other code. Treat this as a real, flagged gap, not
// a silently "good enough" placeholder.
export const EN_BLOCKLIST: string[] = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "whore",
  "slut",
  "retard",
  "kill yourself",
  "kys",
];

export const AM_BLOCKLIST: string[] = [];
