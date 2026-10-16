import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
const source = resolve('apps/extension');
const output = resolve('dist/extension');
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.permissions.join(',') !== 'sidePanel,storage' || manifest.host_permissions || manifest.content_scripts) throw new Error('Unexpected extension capabilities');
await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
const relayOrigin = process.env.INBOX_EXTENSION_ORIGIN;
if (relayOrigin) {
  const url = new URL(relayOrigin);
  if (url.protocol !== 'https:' || url.origin !== relayOrigin || url.username || url.password || url.hostname.includes('*')) throw new Error('Relay requires an exact HTTPS origin');
  manifest.externally_connectable = { matches: [relayOrigin + '/*'], ids: [] };
  await writeFile(resolve(output, 'relay-config.js'), `export const relayOrigin = ${JSON.stringify(relayOrigin)};\n`);
}
await mkdir(resolve(output, 'icons'), { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const label = Buffer.from(type); const body = Buffer.concat([label, bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function icon(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const segment = (x, y, ax, ay, bx, by) => {
    const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
    return Math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay)) <= 3.5;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x+.5)*128/size, py=(y+.5)*128/size;
    const ink = [[28,43,100,43],[100,43,100,90],[100,90,28,90],[28,90,28,43],[29,45,64,73],[64,73,99,45]].some(l=>segment(px,py,...l)) || (Math.abs(px-85)+Math.abs(py-31)<11);
    const offset = y*(size*4+1)+1+x*4;
    rows.set(ink ? [0,0,0,255] : [217,43,43,255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size,0); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
for (const size of [16, 32, 48, 128]) await writeFile(resolve(output, `icons/${size}.png`), icon(size));
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Extension built: dist/extension. ${relayOrigin ? 'Pinned dashboard relay packaged; backend approval and live Chrome verification required.' : 'Relay disabled; dashboard launcher only.'}`);
