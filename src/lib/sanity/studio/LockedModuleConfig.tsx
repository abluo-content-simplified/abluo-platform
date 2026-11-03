'use client'

import type { ModuleConfigFieldDef } from '../../modules/types'
import { DASHBOARD_CONFIG_NOTICE, configValueText } from './config-lock'

/**
 * The Modules pane's Configuration section for a dashboard-configured module (C9 §9.3 R2 lock):
 * the stored values as text, no inputs, and where they are edited. Admin UI (English, CLAUDE.md
 * exception); styling follows the rest of the pane.
 */
export function LockedModuleConfig({ fields, config }: { fields: readonly ModuleConfigFieldDef[]; config: Record<string, unknown> | undefined }) {
  return (
    <div data-testid="locked-module-config">
      <div role="note" style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        {DASHBOARD_CONFIG_NOTICE}
      </div>
      <dl style={{ margin: 0 }}>
        {fields.map((field) => (
          <div key={field.id} style={{ marginBottom: 12 }}>
            <dt style={{ fontSize: 12, fontWeight: 500, color: '#111' }}>{field.label}</dt>
            <dd style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>{configValueText(config?.[field.id])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
