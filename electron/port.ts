import getPort from 'get-port'

/** Default port range for the FastAPI sidecar */
const SIDECAR_PORT_RANGE = { start: 18200, end: 18300 } as const

/**
 * Find an available port for the FastAPI sidecar.
 * Prefers ports in the 18200-18300 range but falls back to any available port.
 */
export async function findSidecarPort(): Promise<number> {
  const port = await getPort({
    port: makeRange(SIDECAR_PORT_RANGE.start, SIDECAR_PORT_RANGE.end)
  })
  return port
}

/** Generate a range of port numbers (inclusive start, exclusive end) */
function makeRange(start: number, end: number): Iterable<number> {
  const ports: number[] = []
  for (let i = start; i < end; i++) {
    ports.push(i)
  }
  return ports
}
