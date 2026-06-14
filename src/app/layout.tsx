import type { Metadata } from "next";
import Script from "next/script";
import { Geist_Mono, Barlow_Condensed, Poppins } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Abluo",
  description: "Content. Simplified.",
};

// ─── FOUC prevention script ───────────────────────────────────────────────────
// Runs synchronously before first paint.
// Dark-first: `:root` = dark (no class). `html.light` = light override.
// Reads `abluo-theme` from localStorage; falls back to system preference.
const themeScript = `(function(){try{var t=localStorage.getItem('abluo-theme');if(t==='light'){document.documentElement.classList.add('light');}else if(t==='dark'){/* default — no class needed */}else{if(!window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('light');}}}catch(e){}})();`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistMono.variable} ${barlowCondensed.variable} ${poppins.variable} h-full antialiased`}
    >
      <head>
        {/* Theme preference applied before paint to prevent flash */}
        <Script id="theme-script" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
