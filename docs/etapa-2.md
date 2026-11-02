# Etapa 2: plantillas y ejecución real de entrenamientos

## Estado y autorización

La Etapa 1 fue aprobada funcionalmente por el usuario tras sus pruebas en iPhone. El PR #1 se fusionó en `69eaac3` después de incorporar y verificar `git.deploymentEnabled: false` en su commit `6068ba6`. No se modificó la configuración del proyecto Vercel de producción ni sus alias; se verificó que conserva `dpl_GTANFiXs3eiz6Pyt6Y3cDXmVP4a7` y el código de `542edca`. El proyecto de prueba sigue publicando exclusivamente la Etapa 1 (`dpl_563NFCX8BdPDYcqMvDKvZyC7bt7g`).

Esta implementación se desarrolla en `feat/stage-2-workout-templates`, separada de main. No está fusionada ni desplegada. La configuración heredada bloquea despliegues Git de todas las ramas; cualquier publicación manual o cambio de esa regla requiere autorización.

## Rutina de entrada

Fuente: `Rutina Gym 1-NOV.xlsx`, hoja `Hoja1`. SHA256 `ec2ef2a22bf945c0d2e86f175550cdcbe9b9224b133aefd3ba2b2193d85938b3`.

Se transcribieron 27 ejercicios: 7/7/7/6 por día, todos con tres series. Se conservan los rangos numéricos de repeticiones/RIR y los destinos reales de los hipervínculos, incluso cuando el texto visible es el título del video. Cuatro ejercicios carecen de enlace y siguen así. Los grupos son Día 1 `3A/3B`, Día 2 `4A/4B/4C` y Día 4 `2A/2B`. No se separaron ejercicios compuestos que la planilla presenta como una sola fila.

`src/data/templates.ts` contiene la nueva plantilla versionada `routine-2026-11-01`. `src/data/routine.ts` permanece intacto para identificar el catálogo anterior y servir de último recurso de lectura legacy. Se reutilizan IDs solo cuando el nombre coincide exactamente con un ejercicio anterior: Sentadilla + gemelos conserva identidad, pero sus entrenamientos nuevos pertenecen al Día 2 y sus sesiones anteriores siguen en su día original. No se fusionan por semejanza “BICEPS INVERTIDO” y “CURL DE BICEPS INVERTIDO”, ni variantes de aparato. Una equivalencia futura requerirá una decisión explícita, sin alterar datos originales.

## Comportamiento implementado

- Abrir Día 1–4 crea/reanuda únicamente un borrador, sin fila de entrenamiento, fecha de inicio, duración ni aportes al historial/estadísticas. Sustituir/agregar/omitir y agregar series vacías tampoco inicia una sesión.
- El primer valor numérico válido y no vacío de peso, reps o RIR crea la sesión junto con la primera escritura, en una transacción. Cero cuenta como dato capturado; eso no convierte una serie con cero reps en serie válida para estadísticas. Las otras filas pueden seguir vacías.
- Un borrador por día tiene un token de generación. Se reabre al volver a la pantalla. No crea una segunda sesión al editar simultáneamente ni permite registrar otro día mientras haya una sesión activa: la pantalla ofrece continuar la existente. No descarta automáticamente nada.
- El entrenamiento guarda el día original y la versión de plantilla. Ejercicios tomados de otro día no cambian esa identidad.
- Sustituir antes de registrar datos cambia solo ese ejercicio del borrador/entrenamiento. Después de registrar cualquier dato conserva íntegra la fila anterior y agrega la sustitución como otra fila, vinculada al ejercicio originalmente planificado. Cada ejecución conserva su propia instantánea.
- Agregar permite seleccionar ejercicios del catálogo actual o anterior, sin modificar la plantilla. No se implementa un editor de ejercicios personalizados fuera de esos catálogos.
- Omitir un ejercicio vacío no crea ceros; queda identificado como omitido y sin series. Se puede reactivar. Para proteger registros, se rechaza omitir una fila que ya tenga algún dato; sus series se conservan y puede agregarse una sustitución.
- Las filas nuevas usan el guardado FIFO, indicadores de error y reintento de Etapa 1. El borrado de una serie espera sus escrituras y solo descarta borradores fallidos cuando tuvo éxito.
- Finalizar espera todas las escrituras. La sesión y sus PRs se actualizan atómicamente y se retira el borrador asociado. Tokens de formularios terminados/restaurados impiden que ventanas antiguas vuelvan a abrir una sesión o sobrescriban una restauración.
- Una sesión legacy todavía activa se reanuda con su lista original y sus IDs, no con la plantilla nueva. Abrirla no escribe en las cuatro tablas históricas.

## Migración Dexie v1 → v2

Se conserva `gym-tracker-db` y se agregan tres tablas, sin cambiar los índices de las cuatro existentes:

| Tabla nueva | Propósito |
| --- | --- |
| `templates` | Definiciones versionadas e independientes de los entrenamientos |
| `exerciseSnapshots` | Metadatos congelados por ID de ejercicio realizado, incluida referencia al planificado |
| `workoutDrafts` | Selecciones, omisiones y filas vacías previas al inicio; asociación con la sesión después de registrar |

El upgrade solo inserta instantáneas en la nueva tabla dentro de la transacción de cambio de versión. No modifica, renumera ni elimina ejercicios, entrenamientos, ejercicios realizados o series existentes. Ante un fallo se revierte el cambio de versión y las tablas nuevas; la prueba nativa verifica que vuelve a abrir como v1 con cada fila intacta y que luego puede reintentar el upgrade.

Las instantáneas legacy usan primero el catálogo almacenado, después la definición anterior conocida y, si no hay ninguna, una identificación explícita “Ejercicio histórico (ID)” con procedencia `legacy-unknown`. Esos campos de presentación de último recurso no crean series ni métricas. No se puede recuperar un nombre histórico que la versión anterior ya hubiera sobrescrito: se registra la procedencia y no se afirma reconstrucción exacta de información perdida.

Para nuevas ejecuciones se captura el ejercicio y sus objetivos al crear la fila. Modificar el catálogo o una plantilla después no cambia esa vista histórica. Las adiciones al catálogo solo insertan IDs faltantes; no se reemplazan entradas antiguas al abrir la aplicación.

No hay `deleteDatabase`, reset automático ni conversión de ceros en omisiones. Inconsistencias preexistentes no se reparan ni eliminan silenciosamente.

## Backups y restauración

La exportación pasa a JSON **v2**, incluyendo las siete tablas en una instantánea consistente. Las copias de borradores activos se hidratan desde las series reales para no exportar valores desactualizados. El importador sigue leyendo archivos v1 válidos y construye sus metadatos legacy dentro de la misma transacción de restauración. No exige que estén completos ni cambia los valores nulos o cero.

La validación v2 comprueba versiones, tipos, valores, días originales, plantillas, instantáneas, tokens, estados, identidades y relaciones de borradores, sesiones y series. Admite repetir un ejercicio real en distintas filas de una sesión; ese caso es intencional al agregar o sustituir, no un ID de fila duplicado. Acepta cambios en el orden de miembros JSON. Impide presentar un archivo v2 como v1 para omitir sus metadatos.

Se mantienen la advertencia, copia previa y segundo consentimiento de Etapa 1. Una restauración fallida revierte las siete tablas, incluso si falló al insertar instantáneas después de limpiar/iniciar otras tablas. Una restauración exitosa rota solo los tokens operativos de borrador para invalidar formularios abiertos; los IDs históricos y valores no se regeneran.

Los backups v2 **no son importables por la aplicación v1 antigua**. Antes de un despliegue futuro conservar una copia v1 anterior. Después del upgrade, volver a publicar el bundle antiguo no baja la versión de IndexedDB: se requiere una corrección hacia adelante compatible con v2 o un procedimiento de recuperación expresamente revisado. No se ofrece como rollback seguro borrar la base o restaurar parcialmente un archivo. Cerrar las ventanas antiguas y guardar antes de activar una versión con cambio de esquema sigue siendo obligatorio para el ensayo.

## Estadísticas

`isValidSet` centraliza el criterio: peso finito >= 0 y repeticiones enteras > 0. RIR puede estar ausente; no es requisito para volumen, carga, reps o e1RM. Peso cero con reps positivas es una serie válida; produce volumen/e1RM cero y conserva la métrica de repeticiones. Datos parciales, no finitos o con cero reps no contribuyen a métricas, conteos ni PRs.

No se borran esos registros, ni se recalculan flags de PR históricos al migrar. Los registros completos siguen disponibles en el detalle de la sesión; las comparaciones por ejercicio usan solo sesiones con series válidas. Si un ejercicio aparece varias veces en un entrenamiento, sus series se agregan una sola vez por sesión para gráficos, referencias y comparación de volumen. Los PRs nuevos se evalúan sobre esas series válidas. Reconsultar una finalización ya guardada no modifica duración, fechas o flags existentes.

## Archivos principales

- `src/data/templates.ts`: transcripción del Excel e identidad de versión.
- `src/lib/types.ts`, `db.ts`, `snapshots.ts`: modelo aditivo, upgrade transaccional y congelación de metadatos.
- `src/lib/workouts.ts`: borradores, primer registro, sustituciones, adiciones, omisiones y edición de series.
- `src/lib/repo.ts`, `backup.ts`, `calculations.ts`: lectura histórica, finalización, snapshots v2/importación v1 y regla única de métricas.
- `src/components/DayWorkout.tsx`, `ExerciseBlock.tsx`, `SetRow.tsx`, `src/app/dia/[day]/page.tsx`: pantalla de plantilla y ejecución, catálogo seleccionable y persistencia con feedback.
- Pantallas de historial, progreso y ejercicio: acceso tanto a ejercicios nuevos como anteriores y lectura de metadatos congelados.
- `public/sw.js`: namespace de caché v3 preparado para una futura actualización, conservando la espera natural y sin recargar clientes. No fue desplegado.
- `tests/stage2.js`, `tests/browser.js`, `tests/run.cjs`: regresiones, upgrade nativo y pantalla React completa en navegador. El runner incluye el polyfill de proceso usado por Next Link al compilar fuera de Next y captura excepciones de navegador para fallos de carga de la suite. Sin nuevas dependencias de la aplicación.

## Verificación y siguiente paso

La suite suma 50 pruebas con IndexedDB real en Chromium y perfiles temporales: las 32 regresiones de Etapa 1, fixture v1, primer registro concurrente desde dos contextos, errores y aborto de upgrade, conservación de filas, omisiones, sustituciones, adiciones, cambio de catálogo, backups v2 con rollback y tokens obsoletos. La pantalla real se prueba abriendo la plantilla, cambiando ejercicios, reabriendo el borrador, registrando una serie y finalizando con una escritura todavía pendiente.

- `npm test`: 50/50 aprobadas.
- `npm run lint`, `npm run typecheck`, `git diff --check`: aprobados.
- `npm run build -- --webpack`: compilación de producción aprobada.
- `npm run build`: falla en este entorno por `Operation not permitted` al abrir un puerto interno de Turbopack/PostCSS. No se declara aprobado. El build estándar que sí pasó en Vercel correspondía a Etapa 1, no prueba el build remoto de Etapa 2.

No se usó historial personal ni se ejecutaron migraciones sobre la PWA publicada. La Etapa 2 necesita revisión del PR y autorización para un despliegue de prueba separado, seguido por pruebas físicas Safari/iPhone, antes de considerar una publicación. Las pruebas físicas aprobadas por el usuario son de Etapa 1 y no se trasladan automáticamente a esta migración.
