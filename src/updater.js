// Actualizaciones automáticas del código de Nimbo (no hace falta volver a descargar la app entera).
// Se publica un archivo update.json con la versión y todos los archivos del código.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// Dirección del archivo de actualizaciones. Se puede cambiar en Ajustes (campo avanzado) o con NIMBO_UPDATE_URL.
const DEFAULT_URL = 'https://raw.githubusercontent.com/lucasantola2-coder/nimbo/main/update.json';
const ALLOWED_FILE = /^(main\.js|preload\.js|package\.json|loader\.js|(src|renderer|assets)\/[\w.\-/]+)$/;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function createUpdater({ log, currentVersion, getUrl, onUpdated }) {
  const base = path.join(app.getPath('userData'), 'updates');
  const stateFile = path.join(base, 'state.json');
  let checking = false;
  let last = { at: 0, status: 'idle', message: '', available: null };

  function readState() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } }
  function writeState(st) { fs.mkdirSync(base, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st, null, 2)); }

  async function check({ manual = false } = {}) {
    if (checking) return last;
    const url = (getUrl() || DEFAULT_URL).trim();
    if (url.includes('/OWNER/')) { last = { at: Date.now(), status: 'off', message: 'Las actualizaciones automáticas todavía no están configuradas.' }; return last; }
    checking = true;
    try {
      log('buscando actualizaciones en', url);
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
      if (res.status === 404) { last = { at: Date.now(), status: 'off', message: 'Todavía no hay actualizaciones publicadas.' }; return last; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const upd = await res.json();
      if (!upd.version || !upd.files) throw new Error('archivo de actualización inválido');
      if (cmpVersion(upd.version, currentVersion) <= 0) {
        last = { at: Date.now(), status: 'latest', message: `Tienes la última versión (${currentVersion}).` };
        return last;
      }
      const st = readState();
      if ((st.bad || []).includes(upd.version)) {
        last = { at: Date.now(), status: 'bad', message: `La versión ${upd.version} falló al arrancar en este PC; se ignora.` };
        return last;
      }
      // La versión de Electron tiene que ser compatible; si no, hay que descargar la app completa
      const major = Number(process.versions.electron.split('.')[0]);
      if (upd.minElectron && major < upd.minElectron) {
        last = { at: Date.now(), status: 'full', available: upd.version, downloadUrl: upd.fullDownload || '', message: `La versión ${upd.version} necesita descargar Nimbo completo.` };
        return last;
      }
      // Verificar integridad
      const hash = crypto.createHash('sha256');
      for (const name of Object.keys(upd.files).sort()) { hash.update(name); hash.update(upd.files[name]); }
      if (upd.sha256 && hash.digest('hex') !== upd.sha256) throw new Error('la descarga llegó dañada');
      // Escribir en una carpeta nueva
      const dir = path.join(base, upd.version);
      const tmp = dir + '.tmp';
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const [name, b64] of Object.entries(upd.files)) {
        if (!ALLOWED_FILE.test(name) || name.includes('..')) throw new Error('archivo no permitido en la actualización: ' + name);
        const out = path.join(tmp, name);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, Buffer.from(b64, 'base64'));
      }
      if (!fs.existsSync(path.join(tmp, 'main.js'))) throw new Error('falta main.js en la actualización');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      // borrar versiones viejas descargadas (dejar la actual y la nueva)
      for (const d of fs.readdirSync(base)) {
        if (d !== upd.version && d !== st.current && /^\d+\.\d+\.\d+$/.test(d)) fs.rmSync(path.join(base, d), { recursive: true, force: true });
      }
      writeState({ ...st, current: upd.version, attempts: 0 });
      log('actualización lista:', upd.version);
      last = { at: Date.now(), status: 'ready', available: upd.version, notes: upd.notes || '', message: `Nimbo ${upd.version} está listo.` };
      onUpdated(upd, manual);
      return last;
    } catch (e) {
      log('error al actualizar:', e.message);
      last = { at: Date.now(), status: 'error', message: 'No se pudo buscar actualizaciones: ' + e.message };
      return last;
    } finally { checking = false; }
  }

  return { check, get last() { return last; } };
}

module.exports = { createUpdater, DEFAULT_URL };
