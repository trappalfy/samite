import type { MetadataRoute } from "next"
import { brand } from "@samite/config/brand"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.name,
    description: brand.line,
    start_url: "/",
    display: "browser",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [{ src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" }],
  }
}
