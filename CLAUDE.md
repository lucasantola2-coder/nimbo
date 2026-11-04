# Nimbo

Dock para Windows 10/11 (Electron) que reemplaza la barra de tareas. El usuario habla español (Argentina); responder en español.

## Publicar una actualización (el usuario no descarga nada)
Las PCs con Nimbo ≥ 1.2.0 se actualizan solas desde este repositorio:
1. Hacer el cambio y subir `"version"` en `package.json` (siempre mayor que la publicada).
2. `node scripts/make-update.js "Notas cortas en español"`: regenera `update.json` (todo el código en base64) y `version.json`.
3. Commit y `git push origin main`. Nimbo pregunta por `version.json` cada hora (o con "Buscar actualizaciones"), descarga `update.json` y se reinicia.

Solo viajan `main.js`, `preload.js`, `loader.js`, `package.json`, `src/`, `renderer/`, `assets/`. Si hace falta una dependencia nueva de npm o cambiar la versión de Electron, la actualización automática no alcanza: subir `minElectron` en el script y generar un zip completo (`npx electron-builder --win zip --x64 -c.win.signAndEditExecutable=false`).

## Estructura
- `loader.js`: arranque; elige código original o actualización descargada (`%APPDATA%\Nimbo\updates`) y vuelve atrás si falla 2 veces.
- `main.js`: ventanas (dock, panel, vista previa), sondeos, automatizaciones, IPC.
- `src/helper.ps1` + `src/NimboWin.cs`: puente nativo de Windows vía PowerShell 5.1. El C# debe compilar como **C# 5** (`mcs -langversion:5 -r:System.Drawing.dll src/NimboWin.cs`).
- `src/apps.js`: ancladas, agrupación por AppUserModelID (perfiles de Chrome/Edge), íconos del shell y lista del buscador.
- `src/services.js`: clima (Open-Meteo), calendario iCal, Claude Code (logs locales), costos de API y GitHub.
- `renderer/`: interfaz; `widgets.js` define cada widget.

## Probar sin Windows
- `NIMBO_SELFTEST=settings xvfb-run -a npx electron . --no-sandbox` abre un panel y lo registra.
- Lo nativo de Windows no corre en Linux: pedir al usuario el registro (clic derecho en el dock → "Abrir registro de diagnóstico", `%APPDATA%\Nimbo\nimbo.log`).
