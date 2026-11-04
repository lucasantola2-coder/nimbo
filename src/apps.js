// Apps del dock: ancladas, ventanas abiertas agrupadas (por app y por perfil), íconos y lista para el buscador.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { spawn } = require('child_process');

const ICON_SIZE = 64;
const norm = (p) => (p || '').toLowerCase();
const expandEnv = (p) => (p || '').replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? process.env[k.toUpperCase()] ?? m);
// Carpetas conocidas que usa la lista de apps de Windows en lugar de rutas
const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramFiles || 'C:\\Program Files',
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.windir || 'C:\\Windows',
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(process.env.windir || 'C:\\Windows', 'System32'),
};
function appIdToExe(id) {
  if (!id || !/\.exe$/i.test(id)) return '';
  const m = id.match(/^(\{[0-9A-F-]+\})\\(.*)$/i);
  if (m && KNOWN_FOLDERS[m[1].toUpperCase()]) return path.join(KNOWN_FOLDERS[m[1].toUpperCase()], m[2]);
  return /^[a-z]:\\/i.test(id) ? id : '';
}
const isAumid = (id) => /!/.test(id || '') && !/\\/.test(id || '');

const isPackagedApp = (exe) => /\\WindowsApps\\|\\ApplicationFrameHost\.exe$/i.test(exe || '');

function createApps({ helper, slow, log, onIcons, isWin }) {
  const icons = {};          // clave -> data URL ('' = no se pudo)
  const pending = new Set();
  let queue = [];
  let working = false;
  let pinned = [];
  let groups = [];
  let appList = null;
  let appListAt = 0;

  // ---------------------------------------------------------- íconos
  function needIcons(keys) {
    for (const k of keys) if (k && !(k in icons) && !pending.has(k)) { pending.add(k); queue.push(k); }
    if (!working) drain();
  }
  async function drain() {
    working = true;
    while (queue.length) {
      const batch = queue.splice(0, 16);
      let res = null;
      if (isWin) res = await slow.safe('icons', { paths: batch, size: ICON_SIZE });
      const patch = {};
      for (const k of batch) {
        let url = res?.icons?.[k] ? 'data:image/png;base64,' + res.icons[k] : '';
        if (!url && !k.startsWith('shell:') && !k.includes(',')) {
          try { url = (await app.getFileIcon(k, { size: 'large' })).toDataURL(); } catch { url = ''; }
        }
        icons[k] = url; patch[k] = url; pending.delete(k);
      }
      onIcons(patch);
    }
    working = false;
  }

  function windowIconKey(w) {
    if (w.relaunchIcon) return expandEnv(w.relaunchIcon);              // p. ej. el ícono del perfil de Chrome
    if (w.aumid && isPackagedApp(w.exe)) return 'shell:AppsFolder\\' + w.aumid;  // apps de la Microsoft Store
    return w.exe;
  }

  // ---------------------------------------------------------- ancladas
  let nimboPins = [];   // apps ancladas desde Nimbo: { id, name } (id = id de app de Windows o ruta a un .exe)
  async function loadPinned(extra) {
    if (extra) nimboPins = extra;
    if (!isWin) return;
    const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.lnk')); } catch {}
    const lnks = files.map((f) => path.join(dir, f));
    const info = (await slow.safe('links', { paths: lnks }))?.links || [];
    pinned = lnks.map((lnk, i) => {
      let target = info[i]?.target || '';
      if (!target) { try { target = shell.readShortcutLink(lnk).target || ''; } catch {} }
      return { name: path.basename(lnk, '.lnk'), lnk, aumid: info[i]?.aumid || '', exe: expandEnv(target), iconKey: lnk };
    });
    for (const p of nimboPins) {
      const exe = appIdToExe(p.id) || (/\.exe$/i.test(p.id) ? p.id : '');
      const aumid = exe ? '' : (/\\/.test(p.id) ? '' : p.id);
      // si Windows ya la tiene anclada, no repetirla
      if (pinned.some((x) => (aumid && norm(x.aumid) === norm(aumid)) || (exe && norm(x.exe) === norm(exe)))) continue;
      pinned.push({ name: p.name, appId: p.id, nimbo: true, aumid, exe, iconKey: /^[a-z]:\\/i.test(p.id) ? p.id : 'shell:AppsFolder\\' + p.id });
    }
    needIcons(pinned.map((p) => p.iconKey));
    log('apps ancladas:', pinned.map((p) => `${p.name} [${p.aumid || '-'}] ${p.exe || '-'}`));
  }

  // ---------------------------------------------------------- agrupar ventanas
  function displayName(w) {
    const n = w.relaunchName && !w.relaunchName.startsWith('@') ? w.relaunchName : '';
    return n || path.basename(w.exe || '', '.exe') || w.title;
  }

  function setWindows(windows) {
    const items = pinned.map((p) => ({ key: 'pin:' + norm(p.lnk || p.appId), name: p.name, lnk: p.lnk, appId: p.appId, nimbo: !!p.nimbo, aumid: p.aumid, exe: p.exe, iconKey: p.iconKey, windows: [], claimed: null }));
    const byKey = new Map();
    for (const w of windows) {
      const gkey = norm(w.aumid) || norm(w.exe) || 'hwnd:' + w.hwnd;
      let it = byKey.get(gkey);
      if (!it && w.aumid) it = items.find((i) => i.aumid && norm(i.aumid) === norm(w.aumid));
      // sin coincidencia por id de app: usar la anclada del mismo programa si nadie la tomó todavía
      if (!it) it = items.find((i) => i.exe && norm(i.exe) === norm(w.exe) && (!i.claimed || i.claimed === gkey) && (!i.aumid || !w.aumid || !i.windows.length));
      if (!it) {
        it = { key: 'run:' + gkey, name: displayName(w), aumid: w.aumid, exe: w.exe, iconKey: windowIconKey(w), relaunchCmd: w.relaunchCmd, windows: [] };
        items.push(it);
      }
      if (it.claimed === null || it.claimed === undefined) it.claimed = gkey;
      if (w.relaunchCmd && !it.relaunchCmd) it.relaunchCmd = w.relaunchCmd;
      byKey.set(gkey, it);
      it.windows.push({ hwnd: w.hwnd, title: w.title, active: w.active, minimized: w.minimized });
    }
    groups = items.map(({ claimed, ...rest }) => rest);
    needIcons(groups.map((g) => g.iconKey));
    return groups;
  }

  // ---------------------------------------------------------- abrir
  function runCommandLine(cmd) {
    const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }
  function launchAumid(id) {
    const child = spawn('explorer.exe', ['shell:AppsFolder\\' + id], { detached: true, stdio: 'ignore' });
    child.unref();
  }
  async function launch(item) {
    if (!item) return;
    log('abrir app', item.name, item.lnk || item.relaunchCmd || item.aumid || item.exe);
    if (item.lnk) { const err = await shell.openPath(item.lnk); if (!err) return; log('openPath falló', err); }
    if (item.appId && !/^[a-z]:\\/i.test(item.appId)) return launchAumid(item.appId);
    if (item.relaunchCmd) return runCommandLine(item.relaunchCmd);
    if (item.aumid && isPackagedApp(item.exe)) return launchAumid(item.aumid);
    if (item.exe) return shell.openPath(item.exe);
  }

  // ---------------------------------------------------------- buscador
  async function list(force) {
    if (!isWin) return [];
    if (appList && !force && Date.now() - appListAt < 30 * 60e3) return appList;
    const r = await slow.call('apps', {}, 45000).catch((e) => { log('lista de apps falló', e.message); return null; });
    if (r?.apps) {
      const seen = new Set();
      appList = r.apps.filter((a) => { const k = norm(a.name); if (seen.has(k)) return false; seen.add(k); return true; })
        .map((a) => ({ name: a.name, id: a.id, iconKey: 'shell:AppsFolder\\' + a.id }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      appListAt = Date.now();
      log('apps para el buscador:', appList.length);
    }
    return appList || [];
  }

  async function findApp(re) { return (await list()).find((a) => re.test(a.name)); }

  return {
    icons, needIcons, findApp, appIdToExe, loadPinned, setWindows, launch, launchAumid, list,
    get groups() { return groups; },
    find: (key) => groups.find((g) => g.key === key),
  };
}

module.exports = { createApps };
