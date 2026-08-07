import { OverlayClient } from "@/components/OverlayClient";

// OBS browser-source URL: birq.live/overlay/<username>. Transparent
// background (see page.module.css) — only the alert box itself should be
// visible, composited over the rest of an OBS scene. No TopNav/BottomNav,
// no auth — this is meant to be pasted into OBS, not visited by a viewer.
export default async function OverlayPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <>
      {/* The root layout's <body> otherwise carries an opaque
          --background color (see app/globals.css) — this page is the one
          place in the app that needs to render over OBS's own scene, not
          on top of the platform's usual background. */}
      <style>{`body { background: transparent !important; }`}</style>
      <OverlayClient username={username} />
    </>
  );
}
