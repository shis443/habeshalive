import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HabeshaLive",
    short_name: "HabeshaLive",
    description: "Live streaming and birr gifting for Ethiopian creators",
    start_url: "/",
    display: "standalone",
    background_color: "#151312",
    theme_color: "#151312",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
