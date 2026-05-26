"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Globe, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const languages = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
] as const

export function LanguageSwitcher() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations("topNav")
  const [isPending, startTransition] = React.useTransition()
  const [mounted, setMounted] = React.useState(false)

  // Prevent hydration mismatch by only rendering after mount
  React.useEffect(() => {
    setMounted(true)
  }, [])

  const currentLanguage = languages.find((lang) => lang.code === locale) || languages[0]

  const handleLanguageChange = (languageCode: string) => {
    // Set cookie with long expiry (1 year)
    document.cookie = `NEXT_LOCALE=${languageCode};path=/;max-age=${60 * 60 * 24 * 365}`
    
    // Refresh the page to apply the new locale
    startTransition(() => {
      router.refresh()
    })
  }

  // Show skeleton/placeholder during SSR and initial hydration
  if (!mounted) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
          "text-sidebar-foreground/60"
        )}
        aria-label="Language"
      >
        <Globe className="size-4" />
        <span className="hidden sm:inline text-xs font-medium w-12" />
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
          "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isPending && "opacity-50 pointer-events-none"
        )}
        aria-label={t("language")}
      >
        <Globe className="size-4" />
        <span className="hidden sm:inline text-xs font-medium">
          {currentLanguage.name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="end" sideOffset={8}>
          <DropdownMenuContent className="min-w-[140px]">
            {languages.map((language) => (
              <DropdownMenuItem
                key={language.code}
                onClick={() => handleLanguageChange(language.code)}
                className="flex items-center justify-between"
              >
                <span>{language.name}</span>
                {locale === language.code && (
                  <Check className="size-4 text-[var(--brand)]" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}
