import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { parse } from 'yaml'

const ROOT = resolve(__dirname, '..', '..')

function loadConfig() {
  const raw = readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf-8')
  return parse(raw)
}

describe('electron-builder.yml configuration', () => {
  it('is valid YAML that can be parsed', () => {
    const config = loadConfig()
    expect(config).toBeDefined()
    expect(typeof config).toBe('object')
  })

  it('has correct appId and productName', () => {
    const config = loadConfig()
    expect(config.appId).toBe('com.plonguo.knowhive')
    expect(config.productName).toBe('KnowHive')
  })

  it('configures output directories', () => {
    const config = loadConfig()
    expect(config.directories.output).toBe('dist')
    expect(config.directories.buildResources).toBe('build')
  })

  it('includes compiled output in files', () => {
    const config = loadConfig()
    expect(config.files).toContain('out/**/*')
  })

  it('configures extraResources for python and backend', () => {
    const config = loadConfig()
    expect(config.extraResources).toBeDefined()
    expect(Array.isArray(config.extraResources)).toBe(true)

    const pythonResource = config.extraResources.find(
      (r: { from: string }) => r.from === 'extraResources/python'
    )
    expect(pythonResource).toBeDefined()
    expect(pythonResource.to).toBe('python')

    const backendResource = config.extraResources.find(
      (r: { from: string }) => r.from === 'extraResources/backend'
    )
    expect(backendResource).toBeDefined()
    expect(backendResource.to).toBe('backend')
  })

  it('configures macOS target with dmg and hardened runtime', () => {
    const config = loadConfig()
    expect(config.mac).toBeDefined()
    expect(config.mac.hardenedRuntime).toBe(true)
    expect(config.mac.target).toBeDefined()

    const dmgTarget = config.mac.target.find(
      (t: { target: string }) => t.target === 'dmg'
    )
    expect(dmgTarget).toBeDefined()
    expect(dmgTarget.arch).toContain('arm64')
  })

  it('references macOS entitlements plist files', () => {
    const config = loadConfig()
    expect(config.mac.entitlements).toBe('build/entitlements.mac.plist')
    expect(config.mac.entitlementsInherit).toBe('build/entitlements.mac.plist')
  })

  it('entitlements plist file exists and is valid XML', () => {
    const plistPath = resolve(ROOT, 'build', 'entitlements.mac.plist')
    expect(existsSync(plistPath)).toBe(true)

    const content = readFileSync(plistPath, 'utf-8')
    expect(content).toContain('<!DOCTYPE plist')
    expect(content).toContain('com.apple.security.cs.allow-jit')
    expect(content).toContain('com.apple.security.network.client')
  })

  it('configures macOS app category', () => {
    const config = loadConfig()
    expect(config.mac.category).toBe('public.app-category.productivity')
  })
})
