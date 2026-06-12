# Migration Guide: Theme-Aware Design System (v0.7)

## Overview

This version moves **Section Surfaces**, **Buttons**, and **Cards** from flat structures to **theme-aware variants** (Light Theme / Dark Theme).

**Breaking Change:** Old schema structure will not render correctly in Sanity Studio until migrated.

---

## What Changed

### Before (v0.6)
```javascript
{
  sectionSurfaces: {
    surface1: "oklch(...)",
    surface2: "oklch(...)",
    // ...
  },
  buttons: {
    primary: { background: "...", text: "...", borderRadius: 8 },
    secondary: { ... }
  },
  cards: { background: "...", border: "..." }
}
```

### After (v0.7)
```javascript
{
  sectionSurfaces: {
    lightTheme: {
      surface1: "oklch(...)",
      surface2: "oklch(...)",
    },
    darkTheme: {
      surface1: "oklch(...)",
      surface2: "oklch(...)",
    }
  },
  buttons: {
    primary: {
      lightTheme: { background: "...", text: "...", borderRadius: 8, hover: {...} },
      darkTheme: { background: "...", text: "...", borderRadius: 8, hover: {...} }
    },
    secondary: { ... }
  },
  cards: {
    lightTheme: { background: "...", border: "..." },
    darkTheme: { background: "...", border: "..." }
  }
}
```

---

## Migration Strategy

### Option A: Manual Migration in Studio (Recommended)

1. **Go to Sanity Studio**
   - Navigate to the Design System document for each project
   - Use the new field structure in the "Components" section

2. **For Section Surfaces:**
   - Enter your current values in **Light Theme**
   - For **Dark Theme**, either:
     - Copy the Light Theme values as a starting point, OR
     - Use darker variants from your `colors.darkTheme` palette

3. **For Buttons:**
   - Primary Button → Light Theme (enter current values)
   - Primary Button → Dark Theme (enter theme-appropriate values)
   - Repeat for Secondary Button

4. **For Cards:**
   - Same pattern: Light Theme (current), then Dark Theme (optional tweaks)

5. **Save and Test**
   - Light theme should render identically to v0.6
   - Dark theme will use the new values you just entered

---

### Option B: Programmatic Migration (For Multiple Projects)

If you have many design systems to migrate, create a Sanity migration script:

```javascript
// migration.js
import sanityClient from '@sanity/client'

const client = sanityClient({
  projectId: 'YOUR_PROJECT_ID',
  dataset: 'production',
  token: 'YOUR_TOKEN',
  apiVersion: '2024-01-01'
})

async function migrateDesignSystems() {
  const designSystems = await client.fetch('*[_type == "designSystem"]')

  for (const ds of designSystems) {
    // Only migrate if old structure detected
    if (!ds.sectionSurfaces?.lightTheme && ds.sectionSurfaces?.surface1) {
      const migrated = {
        ...ds,
        // Migrate sectionSurfaces
        sectionSurfaces: {
          lightTheme: {
            surface1: ds.sectionSurfaces.surface1,
            surface2: ds.sectionSurfaces.surface2,
            surface3: ds.sectionSurfaces.surface3,
            brandSurface: ds.sectionSurfaces.brandSurface,
            glass: ds.sectionSurfaces.glass,
          },
          darkTheme: {
            // Start with light theme values; editors can refine
            surface1: ds.sectionSurfaces.surface1,
            surface2: ds.sectionSurfaces.surface2,
            surface3: ds.sectionSurfaces.surface3,
            brandSurface: ds.sectionSurfaces.brandSurface,
            glass: ds.sectionSurfaces.glass,
          }
        },
        // Migrate buttons
        buttons: {
          primary: {
            lightTheme: ds.buttons?.primary || {},
            darkTheme: ds.buttons?.primary || {}
          },
          secondary: {
            lightTheme: ds.buttons?.secondary || {},
            darkTheme: ds.buttons?.secondary || {}
          }
        },
        // Migrate cards
        cards: {
          lightTheme: ds.cards || {},
          darkTheme: ds.cards || {}
        }
      }

      await client.patch(ds._id).set(migrated).commit()
      console.log(`✓ Migrated: ${ds.name}`)
    }
  }

  console.log('✓ Migration complete')
}

migrateDesignSystems().catch(console.error)
```

Run with:
```bash
node migration.js
```

---

## Verification

After migration, verify in the frontend:

1. **Light Mode**
   - Sections should render with lightTheme surfaces
   - Buttons/cards should match light theme styling

2. **Dark Mode**
   - Toggle dark mode (theme switcher or browser DevTools)
   - Sections should render with darkTheme surfaces
   - Buttons/cards should match dark theme styling

---

## Troubleshooting

### "Surfaces not rendering in dark mode"
- Check that `darkTheme` values are set in Design System
- Verify `document.documentElement.classList.contains('dark')` detects theme correctly
- Check browser DevTools: CSS custom properties should update on theme toggle

### "Old button/card colors still showing"
- Old field values are no longer used
- Ensure all projects have been migrated to new schema
- Hard refresh browser cache (Cmd+Shift+R on Mac)

### "Cannot save Design System in Studio"
- Clear browser cache
- Refresh Studio: F5
- Check browser console for validation errors

---

## Rollback Plan

If needed, git checkout `v0.6-checkpoint` and restore Sanity documents from backup.

---

## Next Steps

1. Migrate Livener design system (test project)
2. Test light/dark theme switching
3. Migrate other projects
4. Remove backward compatibility helpers (future version)

