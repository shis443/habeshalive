// Animates a cloned gift icon from wherever it was tapped to the stream's
// <video> element, mirroring the Flutter consumer app's BirqFlyingIcon.
// Fire-and-forget from the caller's point of view — GurshaModal lives in
// the chat column, a DOM sibling of VideoPlayer (not an ancestor/descendant),
// so there's no ref to thread through; document.querySelector is the
// pragmatic way to reach across that boundary without new context plumbing.
export function flyIconToVideo(originEl: HTMLElement, emoji: string, color: string): void {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const originRect = originEl.getBoundingClientRect();
  const video = document.querySelector("video");
  const destRect = video?.getBoundingClientRect();

  const clone = document.createElement("div");
  clone.textContent = emoji;
  clone.style.position = "fixed";
  clone.style.left = "0";
  clone.style.top = "0";
  clone.style.width = "32px";
  clone.style.height = "32px";
  clone.style.display = "flex";
  clone.style.alignItems = "center";
  clone.style.justifyContent = "center";
  clone.style.fontSize = "20px";
  clone.style.borderRadius = "50%";
  clone.style.backgroundColor = `${color}55`;
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "2000";
  clone.style.transformOrigin = "center";
  document.body.appendChild(clone);

  const startX = originRect.left + originRect.width / 2 - 16;
  const startY = originRect.top + originRect.height / 2 - 16;

  if (prefersReducedMotion || !destRect) {
    // No destination to fly to (or motion is disabled) — a quick fade in
    // place still tells the viewer *something* left, rather than nothing.
    clone.style.transform = `translate(${startX}px, ${startY}px)`;
    clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out" }).finished.finally(() =>
      clone.remove()
    );
    return;
  }

  const endX = destRect.left + destRect.width / 2 - 16;
  const endY = destRect.top + destRect.height / 2 - 16;

  clone.style.transform = `translate(${startX}px, ${startY}px) scale(1)`;
  clone
    .animate(
      [
        { transform: `translate(${startX}px, ${startY}px) scale(1)`, opacity: 1 },
        { transform: `translate(${endX}px, ${endY}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: 500, easing: "cubic-bezier(0.3, 0, 0.7, 1)" }
    )
    .finished.finally(() => clone.remove());
}
