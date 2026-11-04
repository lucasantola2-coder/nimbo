// Genera update.json con todo el código de Nimbo, para las actualizaciones automáticas.
// Uso: node scripts/make-update.js "Notas de la versión"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const files = {};
function add(rel) {
  const full = path.join(root, rel);
  if (fs.statSync(full).isDirectory()) { for (const f of fs.readdirSync(full)) add(path.posix.join(rel, f)); return; }
  files[rel] = fs.readFileSync(full).toString('base64');
}
['main.js', 'preload.js', 'loader.js', 'package.json', 'src', 'renderer', 'assets'].forEach(add);
const hash = crypto.createHash('sha256');
for (const name of Object.keys(files).sort()) { hash.update(name); hash.update(files[name]); }
const out = {
  version: pkg.version,
  notes: process.argv[2] || '',
  date: new Date().toISOString(),
  minElectron: Number(pkg.devDependencies.electron.split('.')[0]),
  sha256: hash.digest('hex'),
  files,
};
fs.writeFileSync(path.join(root, 'update.json'), JSON.stringify(out));
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: out.version, notes: out.notes, date: out.date }));
console.log(`update.json: versión ${out.version}, ${Object.keys(files).length} archivos, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
