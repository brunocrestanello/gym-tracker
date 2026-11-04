# Edición explícita del historial y días completados

Rama `fix/locked-history-and-weekly-completion`, desde main `c4b3750e258ff4d58c1e4847ec747fbf876ec24b`. Preparado para revisión; no fusionado ni desplegado. Solo se usan datos sintéticos en perfiles aislados.

## Comportamiento

- Un entrenamiento finalizado se abre en **solo lectura**: series, notas y estructura no ofrecen controles de escritura. Se muestran “Editar entrenamiento” y “Eliminar entrenamiento”; eliminar conserva su confirmación propia.
- “Editar entrenamiento” habilita peso, repeticiones, RIR, notas de sesión/ejercicio, agregar/quitar series, sustituir/agregar ejercicios y omitir/reactivar ejercicios.
- Los cambios viven en un borrador en memoria hasta “Guardar cambios”. “Cancelar edición” los descarta sin escribir. Cerrar/reabrir una edición no guardada vuelve al entrenamiento guardado; el aviso antes de salir es orientativo, no garantiza sobrevivir a un cierre forzado de iOS.
- “Guardar cambios” valida valores y relaciones y ejecuta una sola transacción Dexie: ante un fallo no se aplican cambios parciales. La edición queda abierta para corregir/reintentar. Una comparación del documento original detecta cambios de otra ventana, restauraciones que cambien el documento y eliminación del entrenamiento; una edición vieja no los sobrescribe.
- Permanecen el ID de entrenamiento, fecha, día original, inicio, finalización y duración. No se reabre una sesión terminada ni se crea otra sesión al editarla. Los IDs de filas conservadas permanecen; solo se generan IDs para series/ejercicios que el usuario agrega explícitamente.
- Sustituir un ejercicio con datos conserva la fila original y agrega el sustituto, con sus propias series. Sustituir una fila vacía cambia únicamente esa fila. Para quitar datos del original se puede omitirlo con advertencia explícita: al guardar se eliminan sus series y dejan de contribuir a estadísticas. Reactivar una omisión pendiente permite recuperar las series originales antes de guardar; una omisión ya guardada inicia con campos vacíos al reactivarse. No se fabrican ceros.
- Los récords y gráficos siguen derivándose de las series actuales y responden a guardar o eliminar. El resumen de la pantalla durante la edición se identifica como “Resumen guardado”.

## Finalización involuntaria informada

La revisión de código encuentra una única llamada de UI a `finishSession`, desde el botón de finalizar del día. No hay temporizador, efecto de montaje, cierre de ventana ni service worker que llame a finalizar. No se pudo reproducir ni atribuir con certeza el incidente del iPhone; no se presenta un toque accidental como causa demostrada.

Como protección adicional, “FINALIZAR ENTRENAMIENTO” abre ahora un diálogo nativo con “Seguir entrenando” y “Sí, finalizar entrenamiento”. Solo la segunda acción ejecuta la finalización, esperando escrituras pendientes. Un guard evita confirmaciones duplicadas; ante un fallo el entrenamiento sigue activo y el error aparece dentro del diálogo. Los diálogos nativos bloquean los controles de fondo, gestionan foco y permiten Escape cuando no se está guardando.

## Marca semanal

El usuario eligió reinicio **cada semana, de lunes a domingo**. La semana se calcula con el calendario de America/Montevideo ya usado por la app. Un día se resalta si existe al menos un entrenamiento finalizado de su día original con fecha entre el lunes de esa semana y hoy. No se usa el día actual del catálogo ni se fabrican registros. Una finalización cuenta aunque después se editen u omitan sus ejercicios; la marca representa la existencia del entrenamiento finalizado.

La marca se deriva de IndexedDB, sin nuevas columnas o flags. Se actualiza al finalizar/eliminar/restaurar y revisa la fecha al volver a la app y cada minuto para cubrir el cambio de día/semana sin recargar. Al borrar el último entrenamiento correspondiente se quita el resaltado; borrar uno de varios conserva la marca. El estado se distingue con color, borde y texto “Completado esta semana”, también en el nombre accesible del enlace.

## Conservación y actualización

No se cambia Dexie v2 ni el formato de backups v1/v2. Se reutiliza el validador de backups para verificar la propuesta completa antes de escribir, incluidas relaciones y snapshots. La lectura no modifica registros; los cambios al historial requieren la acción explícita de editar y guardar.

El service worker prepara caché v5 conservando espera de activación, sin `skipWaiting`, `clients.claim` ni recarga forzada. Producción continúa con su versión publicada hasta que el usuario autorice este PR y su despliegue.

## Validaciones

- 79/79 pruebas automatizadas en Chromium e IndexedDB real: conserva las 64 anteriores y suma 15 regresiones de solo lectura, borrador/cancelación, notas/IDs/fecha/día, omisión confirmada, sustitución/adición, valores inválidos y reintento, rollback de escrituras, conflictos entre editores, errores visibles, confirmación de finalización y doble toque, fallo/reintento al finalizar, rechazo de edición de una sesión activa, semana ISO y resaltado reactivo.
- Se adapta la regresión de Etapa 2 para confirmar explícitamente el cierre; se mantiene su verificación de escrituras pendientes antes de finalizar.
- TypeScript, lint, `git diff --check` y build estándar de producción con Turbopack comprobados.
- Smoke de la aplicación compilada con `next start`: ruta real del historial sin inputs al abrir, edición explícita, guardado y retorno a solo lectura; revisión visual móvil en Chromium.
- Pendiente: prueba física en Safari/PWA del iPhone de los nuevos diálogos, foco, teclado y edición. No se declara ejecutada en un dispositivo real. La causa del cierre involuntario continúa sin confirmación empírica.

Archivos principales: `src/lib/history-edit.ts` (lectura/guardado transaccional), `src/components/WorkoutHistory.tsx` (historial bloqueado y edición), `src/components/Modal.tsx` (diálogos), `src/components/DayWorkout.tsx` (confirmación de finalización), `src/lib/completion.ts` / `src/app/page.tsx` / `globals.css` (marca semanal), página wrapper del historial y pruebas.
