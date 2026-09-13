// D.3: NOT Twitch's target list — VK and Reddit are near-irrelevant in
// Ethiopia. Telegram is dominant locally, so it leads. Shared by
// ShareSheet.tsx (reads window.location.href — for the page it's mounted
// on) and OverflowMenu.tsx (needs an explicit url, since a card's overflow
// menu shares the specific stream, not the Explore page it lives on).
export const SHARE_TARGETS = [
  {
    label: "Telegram",
    href: (url: string, text: string) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    label: "WhatsApp",
    href: (url: string, text: string) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    label: "Facebook",
    href: (url: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    label: "X",
    href: (url: string, text: string) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
];
