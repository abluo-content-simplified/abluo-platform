/**
 * Authorization core — ADR-028. See each file for its rules:
 *   roles.ts        role vocabulary (the only place role names are defined)
 *   permissions.ts  platform permission registry + grantable module permissions
 *   resolve.ts      effective permissions (role defaults ∪ extras), pure
 *   check.ts        can(): the single access check, fail closed
 *   grant-rules.ts  no-escalation rules for invites / changes / removals, pure
 */
export * from './roles'
export * from './permissions'
export * from './resolve'
export * from './check'
export * from './grant-rules'
export * from './granter'
