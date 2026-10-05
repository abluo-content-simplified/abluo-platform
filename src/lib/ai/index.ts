/**
 * Provider-agnostic AI layer (ADR-026). SERVER-ONLY — never import from a
 * 'use client' module.
 */
export * from './types'
export { getAiProvider, resolveAiConfig, AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER, type AiProviderId } from './registry'
export { getSiteTone, loadSiteAiContext, toneInstruction, normaliseTone, TONE_MAX_CHARS } from './tone'
