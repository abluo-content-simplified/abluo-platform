// ── Catalogue item fields registered in R1, written later (C10-6 R1 row) ─────
//
// Registered now so that no later writer ever writes an undeclared field; NONE
// is written before its owning slice (REVIEW C-3):
//   - C13 allergen evidence on `allergenDeclaration` (item and free-text
//     choice): `review`, `invalidation`, `declarationVersion` — written only
//     by the review service / invalidation writers (allergen slice);
//   - C6 `readinessOverrides` — written only by `overrideReadiness()` (R2);
//   - C13 `complianceTasks` — written only by the linked-item invalidation (allergen slice).
//
// All are readOnly in Studio, break-glass included (C9 §9.3, C13 §13.3), and
// hidden while empty. Studio is the platform owner's tool: English labels.

import { defineArrayMember, defineField } from 'sanity'

const ro = { readOnly: true } as const
const hiddenWhenEmpty = ({ value }: { value?: unknown }) => value == null || (Array.isArray(value) && value.length === 0)

/** C13 §13.1 — appended to the `allergenDeclaration` object fields (item and option choice). */
export function allergenEvidenceFields() {
  return [
    defineField({
      name: 'review',
      title: 'Review evidence',
      description: 'Recorded by the allergen review in the dashboard. Read-only.',
      type: 'object',
      ...ro,
      hidden: hiddenWhenEmpty,
      fields: [
        defineField({ name: 'reviewedBy', title: 'Reviewed by (user id)', type: 'string', ...ro }),
        defineField({ name: 'reviewedAt', title: 'Reviewed at', type: 'datetime', ...ro }),
        defineField({ name: 'basis', title: 'Basis', type: 'string', ...ro, options: { list: ['recipe', 'supplierLabel', 'technicalSheet', 'riskAssessment', 'other'] } }),
        defineField({ name: 'basisNote', title: 'Basis note', type: 'string', ...ro }),
        defineField({
          name: 'mayContainRiskAssessment',
          title: '“May contain” risk assessment',
          type: 'object',
          ...ro,
          fields: [
            defineField({ name: 'confirmed', title: 'Confirmed', type: 'boolean', ...ro }),
            defineField({ name: 'confirmedBy', title: 'Confirmed by (user id)', type: 'string', ...ro }),
            defineField({ name: 'confirmedAt', title: 'Confirmed at', type: 'datetime', ...ro }),
          ],
        }),
        defineField({ name: 'declarationVersion', title: 'Declaration version', type: 'number', ...ro }),
        defineField({ name: 'contentFingerprint', title: 'Content fingerprint', type: 'string', ...ro }),
        defineField({
          name: 'linked',
          title: 'Linked choices at review time',
          type: 'array',
          ...ro,
          of: [
            defineArrayMember({
              type: 'object',
              name: 'allergenReviewLinked',
              fields: [
                defineField({ name: 'choiceKey', type: 'string', ...ro }),
                defineField({ name: 'itemId', type: 'string', ...ro }),
                defineField({ name: 'fingerprint', type: 'string', ...ro }),
              ],
            }),
          ],
        }),
      ],
    }),
    defineField({
      name: 'invalidation',
      title: 'Why the review was reset',
      type: 'object',
      ...ro,
      hidden: hiddenWhenEmpty,
      fields: [
        defineField({ name: 'cause', title: 'Cause', type: 'string', ...ro }),
        defineField({ name: 'at', title: 'At', type: 'datetime', ...ro }),
      ],
    }),
    defineField({ name: 'declarationVersion', title: 'Declaration version', type: 'number', ...ro, hidden: hiddenWhenEmpty }),
  ]
}

/** C6 §6.9 + C13 §13.1 — appended to the `catalogueItem` document fields. */
export function catalogueItemR1Fields() {
  return [
    defineField({
      name: 'readinessOverrides',
      title: 'Readiness overrides',
      type: 'array',
      ...ro,
      hidden: true,
      of: [
        defineArrayMember({
          type: 'object',
          name: 'catalogueReadinessOverride',
          fields: [
            ...['ruleCode', 'context', 'standard', 'fingerprint', 'by', 'reason'].map((name) => defineField({ name, type: 'string', ...ro })),
            defineField({ name: 'standardVersion', type: 'number', ...ro }),
            defineField({ name: 'at', type: 'datetime', ...ro }),
          ],
        }),
      ],
    }),
    defineField({
      name: 'complianceTasks',
      title: 'Compliance tasks',
      description: 'Created by the system when a linked item’s allergens changed. Resolved by a new allergen review in the dashboard.',
      type: 'array',
      ...ro,
      hidden: hiddenWhenEmpty,
      of: [
        defineArrayMember({
          type: 'object',
          name: 'catalogueComplianceTask',
          fields: [
            ...['taskId', 'kind', 'reason', 'linkedItemId', 'createdBy'].map((name) => defineField({ name, type: 'string', ...ro })),
            defineField({ name: 'choiceKeys', type: 'array', of: [defineArrayMember({ type: 'string' })], ...ro }),
            defineField({ name: 'createdAt', type: 'datetime', ...ro }),
            defineField({ name: 'carriedDraft', type: 'boolean', ...ro }),
            defineField({ name: 'resolvedAt', type: 'datetime', ...ro }),
          ],
        }),
      ],
    }),
  ]
}

/** Every field name this file registers (tests: "registered, never written in R1"). */
export const R1_EVIDENCE_DECLARATION_FIELDS = ['review', 'invalidation', 'declarationVersion'] as const
export const R1_ITEM_FIELDS = ['readinessOverrides', 'complianceTasks'] as const
