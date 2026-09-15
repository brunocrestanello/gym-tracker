# Rutina Bruno — Gym Tracker (PWA)

App personal de tracking de entrenamientos: rutina de 4 días, series/reps/RIR,
referencia del entrenamiento anterior, historial, gráficos de progresión,
récords personales y backup. Pensada para iPhone, instalable como PWA.

## 1. Estructura del proyecto

```
src/
  app/                 Rutas (Next.js App Router)
    page.tsx           Home (4 días + accesos a Historial/Progreso/Ajustes)
    dia/[day]/          Pantalla de entrenamiento activo
    historial/           Lista + detalle/edición de sesiones pasadas
    ejercicio/[id]/       Historial, gráfico de evolución e insights por ejercicio
    progreso/            Selector de ejercicio para ver evolución
    ajustes/              Exportar / importar backup
  components/          UI reutilizable (SetRow, ExerciseBlock, RestTimer, etc.)
  data/routine.ts       Tu rutina actual (extraída de Rutina_Gym.xlsx)
  lib/
    db.ts               Esquema de IndexedDB (Dexie)
    repo.ts             Toda la lógica de datos: sesiones, sets, PRs, backup
    calculations.ts     e1RM (Epley), volumen
    dates.ts             Semana ISO, timezone America/Montevideo
    types.ts             Tipos de datos
public/
  manifest.json, sw.js, icons/   PWA
```

## 2. Correr localmente

Requiere Node.js 20+.

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000`. El service worker y el "Agregar a inicio" se
comportan como PWA real recién con `npm run build && npm run start` o ya
deployado (en `dev` las pantallas funcionan igual, pero el SW no siempre se
registra de la misma forma).

## 3. Deploy

**Vercel (recomendado, es un proyecto Next.js estándar):**

```bash
npm install -g vercel
vercel
```

o conectá el repo desde el dashboard de vercel.com — detecta Next.js
automáticamente, sin variables de entorno necesarias.

**Netlify:** plugin oficial `@netlify/plugin-nextjs`, build command
`npm run build`, sin configuración adicional.

Cualquier plataforma que corra Next.js (Node 20+) sirve igual.

## 4. Instalar como PWA en iPhone

1. Abrí la URL deployada en **Safari** (tiene que ser Safari, no Chrome).
2. Tocá el botón de compartir (el cuadrado con la flecha hacia arriba).
3. Elegí **"Agregar a pantalla de inicio"**.
4. Confirmá el nombre ("Rutina") y tocá **Agregar**.

Queda un ícono en el home screen que abre la app en modo standalone (sin
barra de Safari), con soporte de safe areas (notch / home indicator).

## 5. Dónde modificar la rutina en el futuro

Editá `src/data/routine.ts`. Cada ejercicio es un objeto:

```ts
{
  id: "d1-1a",                 // no lo cambies si ya tenés historial con ese id
  name: "SENTADILLA + GEMELOS",
  day: 1,                      // 1 a 4
  order: 1,                    // orden dentro del día. Mismo order en A y B
                                // de una superserie.
  supersetGroup: null,         // string compartido entre A/B, o null si es individual
  supersetLabel: null,         // "A" | "B" | null
  targetSets: 3,
  targetRepsMin: 6, targetRepsMax: 8,
  targetRirMin: 2, targetRirMax: 2,
  videoUrl: "https://...",     // o null si no tenés link
}
```

Importante: **si cambiás el `id` de un ejercicio con historial registrado, ese
historial queda "huérfano"** (no se asocia al ejercicio nuevo). Para renombrar
sin perder historial, cambiá solo `name` y dejá el `id` igual.

Después de editar el archivo, deployá de nuevo — no hace falta tocar la base
de datos: la app sincroniza nombre/targets/links en cada apertura sin borrar
tus sesiones.

## 6. Cómo exportar tu historial

Home → **Ajustes y backup** → **Exportar backup**: descarga un `.json` con
todo (ejercicios, sesiones, series). **Importar backup** en la misma pantalla
restaura ese archivo (reemplaza los datos actuales por completo, pide
confirmación antes de hacerlo).

Recomendación: exportá backup cada tanto, sobre todo antes de reinstalar la
app o cambiar de celular.

## 7. Qué datos persisten y dónde

- Todo (rutina, sesiones, series, notas, PRs) se guarda en **IndexedDB**,
  local en el dispositivo/navegador. No hay backend ni cuenta.
- **No hay sincronización entre dispositivos** salvo exportar/importar el
  backup manualmente. La capa de datos (`src/lib/repo.ts` + `src/lib/db.ts`)
  está separada de la UI a propósito, para poder conectar Supabase más
  adelante sin tocar las pantallas.
- Si borrás datos de navegación/Safari o desinstalás la app sin haber
  exportado un backup, el historial se pierde.
- El entrenamiento en curso también vive en IndexedDB: si cerrás la app a
  mitad de un entrenamiento, al volver a abrir ese Día lo encontrás tal cual
  lo dejaste.

## 8. Diseño

Dark mode, tipografía nativa de iOS (system-ui para texto, SF Mono para los
números de peso/reps/RIR), acento verde-azulado sobrio, sin gradientes ni
decoración. Pensado para uso a una mano, con inputs numéricos grandes y
teclado numérico de iOS activado automáticamente.
