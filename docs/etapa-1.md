# Etapa 1: integridad de datos y arquitectura

## Base inspeccionada

Repositorio `brunocrestanello/gym-tracker`, `main` en `542edca` (único commit al inspeccionar). No hay un análisis técnico anterior ni instrucciones AGENTS.md en el repositorio recibido. Se verificaron los riesgos directamente en el código, sin acceder a la instalación ni al historial del iPhone.

Confirmado: creación/borrado/finalización de sesiones sin transacción; creación concurrente de sesiones y números de serie; exportación sin instantánea; importación que solo verificaba versión; errores de autoguardado sin feedback. La importación original **ya tenía** una transacción de reemplazo: se conserva y se refuerza con validación previa. El seed original sobrescribía el catálogo al abrir; ahora solo inicializa un catálogo vacío y permite reintentar errores.

## Correcciones y archivos

- `src/lib/repo.ts`: transacciones de lectura/escritura en creación, finalización, borrado, carga completa e instantánea de backup. La búsqueda de sesión activa y su creación comparten transacción; IndexedDB serializa escritores incluso entre pestañas. Numeración de series dentro de transacción con verificación de padres. Si un backup válido contiene un catálogo reducido, al comenzar un día se agregan solo las definiciones faltantes, sin sobrescribir las existentes, para evitar referencias huérfanas. Finalización repetida mantiene fecha, duración y PRs. Se propagan errores de almacenamiento y se rechazan actualizaciones a filas inexistentes y valores no finitos/negativos.
- `src/lib/backup.ts`: validación de un objeto desconocido, copiado antes de escribir. Estructura v1, campos obligatorios, tipos, fechas, semana ISO, rangos no negativos, integridad referencial, IDs únicos, números de serie únicos por ejercicio, ejercicio único por sesión y hasta una sesión activa. No depende del catálogo actual para validar IDs. Un archivo inconsistente se rechaza; no se repara silenciosamente.
- `src/app/ajustes/page.tsx`: validación antes de confirmar, resumen de contenido, advertencia de reemplazo y acción separada para descargar copia previa. Bloqueo durante operaciones; errores explícitos. La descarga usa Blob y revocación diferida de URL para Safari; solicitar la descarga no prueba que el usuario guardó el archivo, por eso se indica verificar Archivos/Descargas.
- `src/lib/persistence.ts` y `src/components/SetRow.tsx`: escritura inmediata en cada edición, estados pendiente/guardado/error, conservación del texto y reintento. Validación completa de números (incluye coma decimal; no acepta `12abc`). Seguimiento por campo y revisión para que una respuesta antigua no oculte un fallo nuevo. Finalizar/exportar/restaurar/eliminar desde detalle esperan escrituras y rechazan fallos pendientes. Una eliminación intencional exitosa descarta los borradores de esa fila.
- `src/lib/db.ts`, `src/components/AppShell.tsx`: seed transaccional, sin sobrescribir catálogo existente y con recuperación ante fallo.
- `src/app/dia/[day]/page.tsx`: errores de creación/finalización, controles deshabilitados al finalizar y descarte + nueva sesión en una transacción; se actualiza UI después del commit. Se comprueba también el día devuelto después de una carrera entre pestañas.
- `src/components/ExerciseBlock.tsx`, `src/app/historial/[id]/page.tsx`, `src/app/ejercicio/[id]/page.tsx`, `src/app/error.tsx`: feedback para fallos de lecturas, agregado/borrado y notas, con reintento sin resetear almacenamiento. Las lecturas reactivas que lanzan errores llegan al límite de error de la ruta.
- `tests/`: pruebas con IndexedDB real en Chromium, dos contextos de navegador, inyección de fallos y prueba del formulario React. Fixture independiente del formato v1 anterior, incluyendo ceros y campos vacíos. `package.json`, `eslint.config.mjs`, `.gitignore`: comandos y exclusión de artefactos generados. Sin nuevas dependencias.
- `vercel.json`: deshabilita despliegues automáticos exclusivamente para `fix/stage-1-data-integrity`; no deshabilita despliegues de main. No se usan comandos de despliegue.

## Compatibilidad y límites de esta entrega

Se mantiene el nombre `gym-tracker-db`, versión Dexie 1, tablas, índices, tipos persistidos, IDs y formato JSON v1. No hay migración, borrado de base, reparación de filas históricas ni cambio de rutina. Las pruebas crean su propio perfil Chromium temporal en un origen local: los borrados/restauraciones de prueba solo afectan datos sintéticos.

Los archivos v1 estructuralmente válidos siguen siendo importables, incluidos valores cero y series vacías. Un v1 que ya contenga duplicados, referencias rotas o valores corruptos se rechaza sin modificar la base. Conservar ese archivo para una futura herramienta de diagnóstico y reparación explícita. Los duplicados que ya estén en la base no se eliminan automáticamente; se previene crear nuevos por las rutas corregidas.

Las transacciones no ofrecen sincronización entre dispositivos ni una copia externa. Safari puede suspender el proceso antes de completar una escritura o expulsar almacenamiento por políticas del sistema. Se inicia el guardado al editar, pero solo se indica éxito después de resolver la escritura. Los borradores fallidos permanecen en memoria y no sobreviven a que iOS mate la PWA: mantener backups externos. La resolución de conflictos de edición del mismo campo entre pestañas sigue siendo “última escritura”; no se incorpora bloqueo de interfaz entre pestañas.

En la revisión final se corrigió el service worker con activación diferida hasta cerrar clientes, caché versionado y exclusión de respuestas RSC. Ver [revisión final](revision-final-etapa-1.md) para pruebas y límites, especialmente la transición desde el worker original. Tampoco se cambió el criterio actual de estadísticas/PRs; corregirlo pertenece a la evolución del modelo con las reglas nuevas.

## Estrategia futura de arquitectura (solo documentación)

1. Separar catálogo de ejercicios, plantillas de rutina y entrenamientos realizados. Las cuatro jornadas serán días de una versión de plantilla, con posiciones y objetivos configurables. Editar una plantilla no modificará entrenamientos pasados.
2. Conservar `WorkoutSession.routineDay` como identificación original histórica. En una versión futura agregar referencias opcionales a plantilla/día/versionado e instantánea del nombre del día. No recalcular el día según los ejercicios efectivamente realizados.
3. Cada ejercicio realizado deberá tener snapshot de nombre, objetivos, orden, agrupación y referencia estable al catálogo. Hoy `getWorkoutSessionFull` y pantallas resuelven nombres mediante el archivo estático `routine.ts`: esa dependencia debe retirarse al introducir snapshots, no en esta etapa.
4. Separar una posición planificada de su ejecución: ejercicio original, ejercicio efectivamente realizado, origen (plantilla/sustitución/adicional), estado explícito (pendiente/realizado/omitido). Una sustitución es temporal para ese entrenamiento. Omitir no genera series de cero; un ejercicio adicional no cambia el día original.
5. Definir una sola función de validez de serie para estadísticas, historial comparativo y PRs. Distinguir captura incompleta, serie válida, omisión y ceros legítimos, incluida carga corporal/cero. No reinterpretar ni borrar ceros legacy sin evidencia: conservarlos y etiquetar su procedencia. Acordar antes el criterio de reps > 0, peso >= 0, métricas aplicables y RIR opcional.
6. Migración aditiva futura: backup v1 previo, inventario de conteos/IDs/huérfanos/duplicados en modo lectura, esquema Dexie v2 con campos opcionales/tablas nuevas y upgrade transaccional, sin `deleteDatabase`, `clear` ni regenerar IDs históricos. Mantener tablas originales mientras se valida la nueva lectura. Si la migración falla, abortar y no marcarla completada; verificar reintentos e idempotencia.
7. Backfill de snapshots desde el catálogo guardado y, solo como fallback identificado, la rutina conocida. No inventar nombres/versiones históricas perdidas; marcar datos no reconstruibles como legacy. No inferir sustituciones, omisiones ni día original desde cambios de ejercicios. Comparar todos los IDs, notas, timestamps y valores antes/después, además de los conteos.
8. Un importador futuro leerá v1 y v2 mediante adaptadores explícitos. v1 se convierte en memoria, valida y restaura en una transacción; exportar v2 solo cuando existan campos que v1 no pueda representar. Mantener fixtures de ambos formatos y pruebas de aborto de upgrade/restauración. Versionar contrato de backup y esquema Dexie de forma independiente.

No se implementaron estas tablas/campos ni funcionalidades de etapa 2.

## Validaciones

La [revisión final](revision-final-etapa-1.md) amplía estas correcciones con cola FIFO de autoguardado, doble consentimiento de restauración y actualización segura del worker. Es la referencia vigente para pruebas y condiciones de publicación.

Ejecutar `npm run typecheck`, `npm run lint`, `npm test` y `npm run build -- --webpack`.

`npm test` usa Node 22+ (WebSocket global), el webpack incluido por Next y Chromium instalado (`CHROMIUM_PATH` permite especificar su ejecutable). No usa la PWA, ni un perfil de navegador personal. Requiere permiso para abrir puertos locales. Compila la suite en `work/tests`, crea un perfil temporal, ejecuta pruebas y devuelve estado distinto de cero ante fallos.

La compilación predeterminada `npm run build` con Turbopack falla en este entorno al crear el proceso de PostCSS y abrir un puerto interno (`Operation not permitted`). Se valida producción con webpack sin cambiar el script de compilación del proyecto.

Pendiente validación manual **antes de fusionar/publicar** en un iPhone de prueba con datos sintéticos: edición rápida de peso/reps/RIR, coma decimal, paso a segundo plano/retorno, falta de espacio, recuperación de error, descarga a Archivos, cancelación de restauración, copia previa y actualización/offline del service worker. No se declara Safari/iPhone validado por las pruebas Chromium.

Resultados de esta entrega: TypeScript aprobado (`npm run typecheck`), lint aprobado (`npm run lint`), 32/32 pruebas aprobadas (`npm test`) y compilación de producción con webpack aprobada (`npm run build -- --webpack`). `npm run build` con Turbopack no aprobado por la restricción de puerto descrita arriba. `git diff --check` sin errores. Safari/iPhone físico no ejecutado. Sin despliegue ni fusión a main.
