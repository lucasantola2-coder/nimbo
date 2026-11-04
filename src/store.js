// Configuración y datos locales. Todo se guarda en la carpeta de datos de la app (%APPDATA%\Nimbo).
// Las claves/tokens se cifran con safeStorage (DPAPI en Windows).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const WIDGETS = [
  'start', 'search', 'taskview', 'apps', 'music', 'weather', 'claudeCode', 'github', 'stats', 'network',
  'todos', 'notes', 'timer', 'calendar', 'pomodoro', 'anthropic', 'openai', 'storage', 'recycle',
  'battery', 'system', 'clock', 'desktop',
];
// Los que vienen apagados de fábrica
const OFF_BY_DEFAULT = ['pomodoro', 'anthropic', 'openai', 'storage', 'recycle', 'calendar'];

const DEFAULTS = {
  settings: {
    style: 'glass',          // glass | dark | light
    taskbar: 'autohide',     // autohide | hide | none
    openAtLogin: false,
    hideOnFullscreen: false,
    use24h: true,
    city: '',
    location: null,          // { name, lat, lon }
    calendars: [],           // URLs iCal secretas
    githubUser: '',
    pomodoroWork: 25,
    pomodoroBreak: 5,
    autoUpdate: true,
    updateUrl: '',
    widgets: WIDGETS.map((id) => ({ id, enabled: !OFF_BY_DEFAULT.includes(id) })),
  },
  data: {
    todos: [],               // { id, text, done }
    notes: '',
  },
};

const SECRET_KEYS = ['anthropicAdminKey', 'openaiAdminKey', 'githubToken'];

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'nimbo.json');
    this.secretFile = path.join(app.getPath('userData'), 'secrets.bin');
    this.state = structuredClone(DEFAULTS);
    this.secrets = {};
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state.settings = { ...DEFAULTS.settings, ...raw.settings };
      this.state.data = { ...DEFAULTS.data, ...raw.data };
      // añadir widgets nuevos que no existían en la configuración guardada
      const known = new Set(this.state.settings.widgets.map((w) => w.id));
      for (const id of WIDGETS) if (!known.has(id)) this.state.settings.widgets.push({ id, enabled: false });
      this.state.settings.widgets = this.state.settings.widgets.filter((w) => WIDGETS.includes(w.id));
      // v1.0.3: la detección de pantalla completa fallaba; se apaga una vez para todos
      if (!raw.settings?.migrated103) { this.state.settings.hideOnFullscreen = false; this.state.settings.migrated103 = true; }
      // v1.1.0: nuevo orden tipo barra de Windows y widgets elegidos por el usuario
      if (!raw.settings?.migrated110) {
        const wasOn = new Set((raw.settings?.widgets || []).filter((w) => w.enabled).map((w) => w.id));
        this.state.settings.widgets = WIDGETS.map((id) => ({ id, enabled: !OFF_BY_DEFAULT.includes(id) && (wasOn.has(id) || ['search', 'taskview', 'system', 'desktop', 'notes', 'network', 'stats', 'github', 'claudeCode'].includes(id) || !raw.settings?.widgets) }));
        this.state.settings.migrated110 = true;
      }
    } catch { /* primera vez */ }
    try {
      const buf = fs.readFileSync(this.secretFile);
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
      this.secrets = JSON.parse(json);
    } catch { this.secrets = {}; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  saveSecrets() {
    const json = JSON.stringify(this.secrets);
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
    fs.writeFileSync(this.secretFile, buf);
  }

  get settings() { return this.state.settings; }
  get data() { return this.state.data; }

  setSettings(patch) { Object.assign(this.state.settings, patch); this.save(); }
  setData(patch) { Object.assign(this.state.data, patch); this.save(); }

  secret(name) { return this.secrets[name] || ''; }
  setSecret(name, value) {
    if (!SECRET_KEYS.includes(name)) return;
    if (value) this.secrets[name] = value; else delete this.secrets[name];
    this.saveSecrets();
  }
  // para la interfaz: solo si existe, nunca el valor
  secretStatus() { return Object.fromEntries(SECRET_KEYS.map((k) => [k, !!this.secrets[k]])); }
}

module.exports = { Store, WIDGETS };
