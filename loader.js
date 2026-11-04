// Nimbo - arranque. Elige qué código ejecutar: el que vino con la app o una actualización descargada.
// Si una actualización falla dos veces seguidas al arrancar, se vuelve al código original.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const BUNDLED_DIR = __dirname;
const BUNDLED_VERSION = require('./package.json').version;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function pickCode() {
  const base = path.join(app.getPath('userData'), 'updates');
  const stateFile = path.join(base, 'state.json');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const ver = st.current;
  const dir = ver ? path.join(base, ver) : null;
  const usable = ver && !(st.bad || []).includes(ver) && cmpVersion(ver, BUNDLED_VERSION) > 0 && fs.existsSync(path.join(dir || '', 'main.js'));
  if (!usable) return { dir: BUNDLED_DIR, version: BUNDLED_VERSION, stateFile, st };
  if ((st.attempts || 0) >= 2) {
    // la actualización no logró arrancar: marcarla como mala y usar el código original
    st.bad = [...new Set([...(st.bad || []), ver])];
    st.current = null; st.attempts = 0;
    try { fs.writeFileSync(stateFile, JSON.stringify(st, null, 2)); } catch {}
    return { dir: BUNDLED_DIR, version: BUNDLED_VERSION, stateFile, st, rolledBack: ver };
  }
  st.attempts = (st.attempts || 0) + 1;
  try { fs.writeFileSync(stateFile, JSON.stringify(st, null, 2)); } catch {}
  return { dir, version: ver, stateFile, st };
}

const pick = pickCode();
global.NIMBO = {
  version: pick.version,
  bundledVersion: BUNDLED_VERSION,
  bundledDir: BUNDLED_DIR,
  codeDir: pick.dir,
  rolledBack: pick.rolledBack || null,
  // la nueva versión avisa que arrancó bien: se reinicia el contador de intentos
  markHealthy() {
    try {
      const st = JSON.parse(fs.readFileSync(pick.stateFile, 'utf8'));
      if (st.attempts) { st.attempts = 0; fs.writeFileSync(pick.stateFile, JSON.stringify(st, null, 2)); }
    } catch {}
  },
};

// Las dependencias (node_modules) siempre se usan desde la app instalada
Module.globalPaths.push(path.join(BUNDLED_DIR, 'node_modules'));
process.env.NODE_PATH = [process.env.NODE_PATH, path.join(BUNDLED_DIR, 'node_modules')].filter(Boolean).join(path.delimiter);
Module._initPaths();

require(path.join(pick.dir, 'main.js'));
