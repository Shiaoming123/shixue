import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const assets = resolve('dist/assets')
const cssFiles = (await readdir(assets)).filter((file) => file.endsWith('.css'))
const css = (
  await Promise.all(cssFiles.map((file) => readFile(resolve(assets, file), 'utf8')))
).join('\n')
const compact = css.replace(/\s+/g, '')

const compactBlocks = findMediaBlocks(compact, [
  '@media(max-width:819px){',
  '@media(width<=819px){',
])
const mediumBlocks = findMediaBlocks(compact, [
  '@media(min-width:820px)and(max-width:1279px){',
  '@media(width>=820px)and(width<=1279px){',
])
const hasMobileShell = compactBlocks.some((block) =>
  /\.shell(?:\[[^\]]+\])?\{[^}]*flex-direction:column/.test(block))
const hasSafeArea = compactBlocks.some((block) =>
  /\.tabbar(?:\[[^\]]+\])?\{[^}]*(?:padding-bottom|bottom):[^;}]*env\(safe-area-inset-bottom,0px\)/.test(block))
const hasIconSidebar = mediumBlocks.some((block) =>
  /\.sidebar(?:\[[^\]]+\])?\{[^}]*width:72px;min-width:72px/.test(block))
const hasOverlayDetail = mediumBlocks.some((block) =>
  /\.(?:detail-drawer|sheet-panel--right)(?:\[[^\]]+\])?\{[^}]*position:fixed/.test(block))

if (!hasMobileShell || !hasSafeArea || !hasIconSidebar || !hasOverlayDetail) {
  console.error('Built CSS is missing the locked 819/820 responsive rules.')
  process.exit(1)
}

console.log('Built mobile layout contract is valid.')

function findMediaBlocks(source, openings) {
  const blocks = []
  for (const opening of openings) {
    let from = 0
    while (from < source.length) {
      const start = source.indexOf(opening, from)
      if (start === -1) break
      const openingBrace = start + opening.length - 1
      let depth = 1
      let cursor = openingBrace + 1
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === '{') depth += 1
        else if (source[cursor] === '}') depth -= 1
        cursor += 1
      }
      if (depth === 0) blocks.push(source.slice(openingBrace + 1, cursor - 1))
      from = cursor
    }
  }
  return blocks
}
