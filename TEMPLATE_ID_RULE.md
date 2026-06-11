# Sanity Template ID Rule — Project-Owned Content Types

## The Rule

**Template IDs must NOT match their schemaType.**

When a template's `id` field equals its `schemaType` field, Sanity's template resolution system bypasses parameterized templates. This prevents the template's `value()` function from being called, and parameters are not passed through.

### Wrong ❌
```typescript
{
  id: 'event',           // ← Matches schemaType
  schemaType: 'event',
  parameters: [{ name: 'projectSlug', type: 'string' }],
  value: (params: any) => ({ projectSlug: params?.projectSlug }),
}
// value() will NOT be called. projectSlug will be empty.
```

### Correct ✅
```typescript
{
  id: 'eventProjectOwned',  // ← Does NOT match schemaType
  schemaType: 'event',
  parameters: [{ name: 'projectSlug', type: 'string' }],
  value: (params: any) => ({ projectSlug: params?.projectSlug }),
}
// value() WILL be called. projectSlug will be populated.
```

## Naming Convention

For project-owned content types, use the convention:

```
id: `{schemaType}ProjectOwned`
```

Examples:
- `schemaType: 'event'` → `id: 'eventProjectOwned'`
- `schemaType: 'post'` → `id: 'postProjectOwned'`
- `schemaType: 'homePage'` → `id: 'homePageProjectOwned'`
- `schemaType: 'siteConfig'` → `id: 'siteConfigProjectOwned'`
- `schemaType: 'designSystem'` → `id: 'designSystemProjectOwned'`

## Implementation Pattern

### 1. Define the template in `src/lib/sanity/schema.ts`:

```typescript
export const initialValueTemplates = [
  {
    id: '{schemaType}ProjectOwned',
    title: 'Display Name',
    schemaType: '{schemaType}',
    parameters: [{ name: 'projectSlug', type: 'string', title: 'Project' }],
    value: (params: any) => ({
      projectSlug: params?.projectSlug,
      // ... other default fields
    }),
  },
]
```

### 2. Register it in `sanity.config.ts`:

```typescript
S.documentList()
  .schemaType('{schemaType}')
  .initialValueTemplates([
    S.initialValueTemplateItem('{schemaType}ProjectOwned', { projectSlug: slug }),
  ])
```

## Why This Happens

Sanity's template resolution has special behavior when `id === schemaType`. It treats this as an auto-generated template and applies its own initialization logic, bypassing the parameterized template system entirely.

This is a Sanity limitation, not a bug in our code. The naming convention sidesteps the issue by making `id !== schemaType`, forcing Sanity to use the parameterized template system.

## When Adding New Content Types

1. Create the schema type definition in `schemaTypes` array
2. Add `projectSlug` as the first field with `readOnly: true` and `validation: Rule.required()`
3. Create a template with `id: '{schemaType}ProjectOwned'` (NOT matching the schemaType)
4. Register the template in the structure tool with `initialValueTemplateItem()`
5. Test: Create a document and verify `projectSlug` is populated
6. Verify: Document appears in project list, NOT in Unassigned Content

## References

- Sanity Structure Tool: https://www.sanity.io/docs/structure-builder-introduction
- Initial Value Templates: https://www.sanity.io/docs/initial-value-templates
- Related Issue: Template ID collision with schemaType breaks parameterized templates
