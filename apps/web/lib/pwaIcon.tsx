import { ImageResponse } from "next/og";

// Shared by app/icons/192/route.tsx and app/icons/512/route.tsx — Next.js's
// special-file icon convention (icon.tsx) only supports one size, PWA
// manifests need several, hence plain route handlers instead.
export function renderPwaIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#151312",
          color: "#e8a33d",
          fontSize: size * 0.55,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        H
      </div>
    ),
    { width: size, height: size }
  );
}
