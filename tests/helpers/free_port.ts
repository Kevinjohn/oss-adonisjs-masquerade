import { createServer } from 'node:net'

/** A TCP port that was free on 127.0.0.1 when this returned. */
export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject)
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP port address')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}
