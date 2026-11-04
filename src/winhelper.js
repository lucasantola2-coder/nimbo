// Puente con el proceso auxiliar de PowerShell (solo Windows).
// En otros sistemas todas las llamadas devuelven null, para poder probar la interfaz.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const isWin = process.platform === 'win32';

class WinHelper {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
  }

  start() {
    if (!isWin || this.proc) return this.ready;
    // Dentro del instalador el script se desempaqueta fuera del .asar
    const script = path.join(__dirname, 'helper.ps1').replace('app.asar', 'app.asar.unpacked');
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, String(process.pid),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    this.ready = new Promise((resolve) => {
      this.pending.set(0, { resolve, reject: resolve });
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error));
    });
    this.proc.stderr.on('data', (d) => console.error('[helper]', d.toString()));
    this.proc.on('exit', (code) => {
      console.error('[helper] terminó con código', code);
      for (const p of this.pending.values()) p.reject(new Error('helper cerrado'));
      this.pending.clear();
      this.proc = null;
    });
    return this.ready;
  }

  async call(cmd, args = {}, timeoutMs = 8000) {
    if (!isWin) return null;
    if (!this.proc) this.start();
    await this.ready;
    if (!this.proc) return null;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${cmd}`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  async safe(cmd, args, fallback = null) {
    try { return await this.call(cmd, args); } catch (e) { console.error('[helper]', cmd, e.message); return fallback; }
  }

  stop() {
    if (!this.proc) return;
    // Cerrar stdin hace que el script restaure la barra de tareas y termine
    try { this.proc.stdin.end(); } catch {}
    const p = this.proc;
    setTimeout(() => { try { p.kill(); } catch {} }, 1500);
  }
}

module.exports = { WinHelper, isWin };
