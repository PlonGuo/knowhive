import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { findSidecarPort } from '../../electron/port'

describe('findSidecarPort', () => {
  it('returns a number', async () => {
    const port = await findSidecarPort()
    expect(typeof port).toBe('number')
  })

  it('returns a port in a valid range', async () => {
    const port = await findSidecarPort()
    expect(port).toBeGreaterThanOrEqual(1024)
    expect(port).toBeLessThanOrEqual(65535)
  })

  it('returns a port that is not currently in use', async () => {
    const port = await findSidecarPort()
    // Verify the port is actually available by binding to it
    const server = net.createServer()
    await new Promise<void>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve())
      server.on('error', reject)
    })
    server.close()
  })

  it('returns different ports when the preferred port is occupied', async () => {
    // Occupy a port in the preferred range
    const port1 = await findSidecarPort()
    const server = net.createServer()
    await new Promise<void>((resolve) => {
      server.listen(port1, '127.0.0.1', () => resolve())
    })

    try {
      const port2 = await findSidecarPort()
      expect(port2).not.toBe(port1)
      expect(typeof port2).toBe('number')
    } finally {
      server.close()
    }
  })
})
