import { Montserrat, Space_Mono } from "next/font/google"

// Montserrat is a variable font: one file per style covers 400–800 (CLAUDE.md §11.3).
export const montserrat = Montserrat({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--ff-montserrat",
  display: "swap",
})

export const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--ff-space-mono",
  display: "swap",
})
