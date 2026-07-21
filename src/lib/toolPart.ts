// Pure helpers for rendering agent tool parts (AI SDK v7 ToolUIPart) in the chat.
// Kept out of the component so labels/status mapping are unit-testable.

export interface ToolPartLike {
  type: string
  state?: string
  input?: unknown
  errorText?: string
  toolName?: string
  approval?: { id: string; approved?: boolean }
}

/** True for AI SDK tool parts: `tool-${name}` (static) or `dynamic-tool`. */
export function isToolPart(part: { type: string }): part is ToolPartLike {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

export type ToolPartStatus = 'running' | 'done' | 'error' | 'needs-approval' | 'denied'

export function toolPartStatus(part: ToolPartLike): ToolPartStatus {
  switch (part.state) {
    case 'output-available':
      return 'done'
    case 'output-error':
      return 'error'
    case 'approval-requested':
      return 'needs-approval'
    case 'output-denied':
      return 'denied'
    default:
      // input-streaming / input-available / approval-responded = in flight
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
  const path = typeof input.path === 'string' ? input.path : undefined
  switch (name) {
    case 'search_knowledge':
      return typeof input.query === 'string' ? `Searching: ${input.query}` : 'Searching…'
    case 'read_note':
      return path ? `Reading: ${path}` : 'Reading note…'
    case 'list_notes':
      return 'Listing notes'
    case 'search_history':
      return typeof input.query === 'string' ? `Searching history: ${input.query}` : 'Searching history…'
    case 'create_note':
      return path ? `Create note: ${path}` : 'Create note…'
    case 'update_note':
      return path ? `Update note: ${path}` : 'Update note…'
    case 'delete_note':
      return path ? `Delete note: ${path}` : 'Delete note…'
    default:
      return name
  }
}
