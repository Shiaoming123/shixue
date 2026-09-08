import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export async function sha256File(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}
