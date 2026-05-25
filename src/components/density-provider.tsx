"use client"

import * as React from "react"

type Density = "compact" | "comfortable" | "large"

interface DensityContextType {
  density: Density
  setDensity: (density: Density) => void
}

const DensityContext = React.createContext<DensityContextType | undefined>(
  undefined
)

const DENSITY_STORAGE_KEY = "abluo-density"

function getDensityClass(density: Density): string {
  switch (density) {
    case "compact":
      return "density-compact"
    case "large":
      return "density-large"
    default:
      return "" // comfortable is the default, no class needed
  }
}

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = React.useState<Density>("comfortable")
  const [mounted, setMounted] = React.useState(false)

  // Load density from localStorage on mount
  React.useEffect(() => {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null
    if (stored && ["compact", "comfortable", "large"].includes(stored)) {
      setDensityState(stored)
    }
    setMounted(true)
  }, [])

  // Apply density class to html element
  React.useEffect(() => {
    if (!mounted) return

    const html = document.documentElement
    // Remove all density classes
    html.classList.remove("density-compact", "density-large")
    // Add the current density class (if not comfortable/default)
    const densityClass = getDensityClass(density)
    if (densityClass) {
      html.classList.add(densityClass)
    }
  }, [density, mounted])

  const setDensity = React.useCallback((newDensity: Density) => {
    setDensityState(newDensity)
    localStorage.setItem(DENSITY_STORAGE_KEY, newDensity)
  }, [])

  const value = React.useMemo(
    () => ({ density, setDensity }),
    [density, setDensity]
  )

  return (
    <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
  )
}

export function useDensity() {
  const context = React.useContext(DensityContext)
  if (context === undefined) {
    throw new Error("useDensity must be used within a DensityProvider")
  }
  return context
}
