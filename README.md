# Nimbo

Dock para Windows 10 y 11 que reemplaza la barra de tareas, con widgets en vivo.

## Usarlo

**Opción A: versión portable (sin instalar)**
1. Descomprime `Nimbo-1.0.0-win.zip` en una carpeta, por ejemplo `C:\Programas\Nimbo`.
2. Abre `Nimbo.exe`. Si aparece SmartScreen, elige «Más información» y luego «Ejecutar de todas formas». Aparece porque la app no tiene firma digital.

**Opción B: desde el código** (necesitas [Node.js](https://nodejs.org) 20 o superior)
```
npm install
npm start
```
Para generar el instalador `.exe` en Windows, ejecuta `npm run dist`. El resultado queda en la carpeta `dist/`.

## Cómo se usa

- **Clic** en un widget: abre su panel.
- **Clic** en una app: la abre, la trae al frente o la minimiza. Si tiene varias ventanas, cada clic pasa a la siguiente.
- **Clic derecho** en una app: lista de ventanas, abrir una nueva o cerrarlas.
- **Clic derecho** en el dock, en el engranaje o en el ícono de la bandeja: ajustes y salir.
- Al cerrar Nimbo, la barra de tareas de Windows vuelve tal como estaba. Esto también pasa si Nimbo se cuelga.

## Widgets

| Grupo | Widgets |
|---|---|
| Sistema | Inicio, apps ancladas y ventanas abiertas, reloj, CPU y RAM, red, discos, batería, papelera |
| Productividad | Calendario (Google, Outlook o iCloud vía enlace iCal), tareas, notas, pomodoro, temporizador y cronómetro |
| Música y clima | Canción actual con controles (Spotify, YouTube, etc.) y clima con pronóstico (Open-Meteo, sin clave) |
| IA y desarrollo | Claude Code (tokens del bloque de 5 h, leídos de tus registros locales), gasto en la API de Anthropic y de OpenAI (clave de administrador), GitHub |

**Automatizaciones:** aviso 5 minutos antes de cada reunión, pausa de la música 1 minuto antes, aviso cuando se reinicia tu bloque de Claude Code y notificaciones del pomodoro y del temporizador.

## Privacidad

No hay cuentas, servidores ni telemetría. La configuración se guarda en `%APPDATA%\Nimbo`. Las claves se cifran con DPAPI de Windows. Cada widget se conecta directamente a su propio servicio.

## Estructura

- `main.js`: ventanas, sondeos de datos, automatizaciones y bandeja.
- `src/helper.ps1`: puente con Windows (ventanas, barra de tareas, música, discos, red, papelera).
- `src/services.js`: clima, calendario, Claude Code, costos de API y GitHub.
- `src/store.js`: configuración y claves cifradas.
- `renderer/`: interfaz (`widgets.js` define cada widget).
