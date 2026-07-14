// Pure helpers for rendering agent tool parts (AI SDK v7 ToolUIPart) in the chat.
// Kept out of the component so labels/status mapping are unit-testable.

export interface ToolPartLike {
  type: string
  state?: string
  input?: unknown
  errorText?: string
  toolName?: string
}

/** True for AI SDK tool parts: `tool-${name}` (static) or `dynamic-tool`. */
export function isToolPart(part: { type: string }): part is ToolPartLike {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

export type ToolPartStatus = 'running' | 'done' | 'error'

export function toolPartStatus(part: ToolPartLike): ToolPartStatus {
  switch (part.state) {
    case 'output-available':
      return 'done'
    case 'output-error':
      return 'error'
    default:
      // input-streaming / input-available / anything pre-output = still working
      return 'running'
  }
}

function toolName(part: ToolPartLike): string {
  if (part.type === 'dynamic-tool') return part.toolName ?? 'tool'
  return part.type.slice('tool-'.length)
}

/** Compact human label: tool + the one argument that matters. */
export function toolPartLabel(part: ToolPartLike): string {
  const name = toolName(part)
  const input = (part.input ?? {}) as Record<string, unknown>
  switch (name) {
    case 'search_knowledge':
      return typeof input.query === 'string' ? `Searching: ${input.query}` : 'Searching…'
    case 'read_note':
      return typeof input.path === 'string' ? `Reading: ${input.path}` : 'Reading note…'
    case 'list_notes':
      return 'Listing notes'
    default:
      return name
  }
}
