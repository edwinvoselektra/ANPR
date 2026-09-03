import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ANPR Platform Buurtpreventie",
    short_name: "ANPR Platform",
    description: "Veilig ANPR-platform voor buurtpreventie",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f9",
    theme_color: "#0b1628",
    lang: "nl",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ]
  };
}
