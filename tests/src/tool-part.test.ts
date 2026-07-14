import { describe, it, expect } from 'vitest'
import { isToolPart, toolPartLabel, toolPartStatus } from '../../src/lib/toolPart'

describe('toolPart helpers', () => {
  it('identifies static and dynamic tool parts', () => {
    expect(isToolPart({ type: 'tool-search_knowledge' })).toBe(true)
    expect(isToolPart({ type: 'dynamic-tool' })).toBe(true)
    expect(isToolPart({ type: 'text' })).toBe(false)
    expect(isToolPart({ type: 'step-start' })).toBe(false)
  })

  it('maps states to running / done / error', () => {
    expect(toolPartStatus({ type: 'tool-x', state: 'input-streaming' })).toBe('running')
    expect(toolPartStatus({ type: 'tool-x', state: 'input-available' })).toBe('running')
    expect(toolPartStatus({ type: 'tool-x', state: 'output-available' })).toBe('done')
    expect(toolPartStatus({ type: 'tool-x', state: 'output-error' })).toBe('error')
  })

  it('labels the three agent tools with their key argument', () => {
    expect(
      toolPartLabel({ type: 'tool-search_knowledge', input: { query: '区间DP' } }),
    ).toBe('Searching: 区间DP')
    expect(toolPartLabel({ type: 'tool-read_note', input: { path: 'a.md' } })).toBe('Reading: a.md')
    expect(toolPartLabel({ type: 'tool-list_notes', input: {} })).toBe('Listing notes')
  })

  it('falls back gracefully while input is still streaming', () => {
    expect(toolPartLabel({ type: 'tool-search_knowledge' })).toBe('Searching…')
    expect(toolPartLabel({ type: 'tool-unknown_thing', input: {} })).toBe('unknown_thing')
  })
})
