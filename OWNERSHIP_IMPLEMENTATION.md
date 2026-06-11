# Project Ownership Implementation

## What Was Fixed

Restored the working ownership mechanism from commit 03cbf72 and applied it consistently across all project-scoped content types.

### Changes Made

#### 1. **sanity.config.ts — Added `.schemaType()` to documentLists**

Every project-scoped documentList now explicitly specifies its schema type:

```typescript
S.documentList()
  .title('Events')
  .schemaType('event')        // ← ADDED
  .filter(`_type == "event" && projectSlug == $slug`)
  .params({ slug })
```

Applied to:
- ✅ Settings (siteConfig)
- ✅ Home Page (homePage)
- ✅ Events (event)
- ✅ Blog Posts (post)
- ✅ Design System (designSystem)

**Why this matters:** `.schemaType()` tells Sanity which template to use when the user clicks "+". Without it, the template never executes and `projectSlug` doesn't get pre-filled.

#### 2. **src/lib/sanity/schema.ts — Fixed template IDs**

Renamed template IDs to match schemaType names (Sanity convention):

```typescript
// Before (causes duplicates):
{ id: 'event_template', schemaType: 'event', ... }

// After (single entry in menu):
{ id: 'event', schemaType: 'event', ... }
```

Applied to all 5 templates:
- siteConfig
- homePage
- event
- post
- designSystem (newly added)

#### 3. **Added comprehensive pattern documentation**

Documented the standard pattern in schema.ts so future developers know exactly how to add new project-scoped content types:

```
// IN SCHEMA: Add projectSlugField as first field
// IN TEMPLATES: Add initial value template setting projectSlug
// IN STRUCTURE: Add .schemaType('myType') to documentList
```

## How It Works

1. **User navigates** to Livener → Events
2. **Clicks "+"** to create new event
3. **Sanity calls** the template's `value()` function
4. **Template receives** `{ projectSlug: "livener-main" }` from `.params({ slug })`
5. **Document is created** with `projectSlug` pre-filled
6. **Document appears** in Livener → Events (not Unassigned)

## Verification Procedure

### Step 1: Restart Dev Server
```bash
npm run dev
```

### Step 2: Hard Refresh Sanity Studio
- Open http://localhost:3000/studio
- Cmd+Shift+R (hard refresh)

### Step 3: Create Test Documents

In **Livener** project:
1. Create a new **Event** → Give it a title → Save
2. Create a new **Home Page** → Give it sections → Save
3. Create a new **Blog Post** → Give it a title → Save

In **Studio Martegani** project:
1. Create a new **Event** → Give it a title → Save

### Step 4: Verify in Studio UI
- Navigate back to Livener → Events → Should see your new event
- Navigate to Livener → Pages → Home Page → Should see your page
- Navigate to Livener → Blog Posts → Should see your post
- **Important:** Check that Unassigned Content is EMPTY (or only shows old broken documents)

### Step 5: Query Actual Stored Data

Run the verification script:
```bash
bash VERIFY_OWNERSHIP.sh
```

This will show the actual stored JSON with:
- `_id`: Document ID
- `_type`: Document type
- `projectSlug`: Should be "livener-main" (not null)

## Pattern for Future Content Types

When adding a new project-scoped content type (e.g., FAQ, Service, Team Member):

### 1. Add projectSlugField to schema
```typescript
const faqType = defineType({
  name: 'faq',
  fields: [
    projectSlugField,  // ← FIRST FIELD
    // ... other fields
  ],
})
```

### 2. Add initial value template
```typescript
export const initialValueTemplates = [
  // ... existing templates
  {
    id: 'faq',
    schemaType: 'faq',
    value: ({ projectSlug }: { projectSlug: string }) => ({
      projectSlug,
      // ... other initial values
    }),
  },
]
```

### 3. Add to studio structure
```typescript
S.listItem()
  .id(`${slug}-faqs`)
  .title('FAQs')
  .child(
    S.documentList()
      .title('FAQs')
      .schemaType('faq')        // ← REQUIRED
      .filter(`_type == "faq" && projectSlug == $slug`)
      .params({ slug })
  ),
```

## Expected Final State

✓ Create menu shows **one entry per content type** (no duplicates)
✓ New documents created inside project get `projectSlug` automatically
✓ Documents appear in correct project folders
✓ Unassigned Content only shows genuinely orphaned documents
✓ `projectSlug` is visible, read-only, and required
✓ Platform is ready for future content types (FAQ, Service, Team Member, Booking, etc.)

## Files Changed

1. `sanity.config.ts` — Added `.schemaType()` to all project-scoped documentLists
2. `src/lib/sanity/schema.ts` — Fixed template IDs, added designSystem template, documented pattern
3. `VERIFY_OWNERSHIP.sh` — Created verification script
4. `OWNERSHIP_IMPLEMENTATION.md` — This file

## Next Steps

1. Run verification script to confirm ownership is assigned
2. Remove any manually-entered projectSlug values from test documents (they should have been auto-assigned)
3. Confirm Unassigned Content is empty
4. Consider adding validation: prevent publishing documents without projectSlug
