// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nimbo', {
  state: () => ipcRenderer.invoke('state'),
  action: (name, args) => ipcRenderer.invoke('action', name, args),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onPanelShow: (cb) => ipcRenderer.on('panel:show', (_e, w) => cb(w)),
  onPanelOpened: (cb) => ipcRenderer.on('panel:opened', (_e, w) => cb(w)),
  onPanelClosed: (cb) => ipcRenderer.on('panel:closed', () => cb()),
  dockSize: (w) => ipcRenderer.send('dock:size', w),
  openPanel: (widget, screenX) => ipcRenderer.send('panel:open', widget, screenX),
  closePanel: () => ipcRenderer.send('panel:close'),
  panelSize: (size) => ipcRenderer.send('panel:size', size),
  log: (...a) => ipcRenderer.send('log', ...a),
  icons: () => ipcRenderer.invoke('icons'),
  onIcons: (cb) => ipcRenderer.on('icons', (_e, p) => cb(p)),
  needIcons: (keys) => ipcRenderer.send('icons:need', keys),
  appsList: () => ipcRenderer.invoke('apps:list'),
  previewShow: (key, x) => ipcRenderer.send('preview:show', key, x),
  previewLeave: () => ipcRenderer.send('preview:leave'),
  previewHover: (inside) => ipcRenderer.send('preview:hover', inside),
  previewSize: (size) => ipcRenderer.send('preview:size', size),
  onPreviewData: (cb) => ipcRenderer.on('preview:data', (_e, d) => cb(d)),
  onPreviewThumbs: (cb) => ipcRenderer.on('preview:thumbs', (_e, t) => cb(t)),
  onPreviewClosed: (cb) => ipcRenderer.on('preview:closed', () => cb()),
});
