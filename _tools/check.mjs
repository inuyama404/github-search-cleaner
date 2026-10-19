import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extension = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));

const referenced = new Set();
Object.values(manifest.icons).forEach((file) => referenced.add(file));
Object.values(manifest.action.default_icon).forEach((file) => referenced.add(file));
referenced.add(manifest.action.default_popup);
manifest.content_scripts.forEach((script) => script.js.forEach((file) => referenced.add(file)));

const missing = [];
for (const file of referenced) {
  if (!fs.existsSync(path.join(extension, file))) missing.push(file);
}

const popupHtml = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8');
for (const match of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^https?:/.test(ref)) missing.push(`remote:${ref}`);
  else if (!fs.existsSync(path.join(extension, ref))) missing.push(`missing:${ref}`);
}

const code = fs.readFileSync(path.join(extension, 'content.js'), 'utf8') + fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const remoteCode = /(fetch\(|XMLHttpRequest|importScripts|https?:\/\/[^\s'"]+\.js)/.test(code);

const icon = fs.readFileSync(path.join(extension, 'icons', 'icon128.png'));
const width = icon.readUInt32BE(16);
const height = icon.readUInt32BE(20);

const result = {
  name: manifest.name,
  version: manifest.version,
  permissions: manifest.permissions,
  missing,
  remoteCode,
  icon128: [width, height],
  files: [...referenced].sort(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(missing.length || remoteCode || width !== 128 || height !== 128 ? 1 : 0);
