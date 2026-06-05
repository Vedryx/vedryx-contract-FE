import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render } from '../dist-ssr/entry-server.js'

const distDir = resolve('dist')
const indexPath = resolve(distDir, 'index.html')
const template = await readFile(indexPath, 'utf8')
const appHtml = render('/')

if (!template.includes('<div id="root"></div>')) {
  throw new Error('Expected empty root element in built index.html')
}

await writeFile(indexPath, template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`))
