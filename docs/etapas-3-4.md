# Etapas 3 y 4: evolución, referencias y nueva interfaz

## Base y alcance

Rama `feat/stage-3-4-insights-interface`, desde el commit aprobado de Etapa 2 `90720d39e5352b68aa0b8541679d8b8f55edbcdc`. PR apilado sobre `feat/stage-2-workout-templates`: depende del PR #2, sin fusionarlo ni modificarlo. No se cambia `main`, la rutina 1-NOV, los identificadores ni el proyecto Vercel de producción. `vercel.json` mantiene `git.deploymentEnabled: false`.

## Criterios de cálculo

- Una serie válida tiene peso finito >= 0 y repeticiones enteras > 0. RIR se conserva, incluso si está vacío; no interviene en las métricas.
- 0 kg con repeticiones positivas es válido (por ejemplo peso corporal). Peso vacío no equivale a 0 kg. Reps 0, campos incompletos y series vacías permanecen almacenados pero no suman estadísticas.
- Solo cuentan entrenamientos finalizados y ejercicios no omitidos. Una sesión activa no altera la referencia ni los récords históricos.
- Cada punto corresponde a un ejercicio por entrenamiento. Apariciones repetidas del mismo ID en un entrenamiento se agregan una sola vez; su día es `WorkoutSession.routineDay`, no el día actual del catálogo.
- Se calculan peso máximo, mayor cantidad de reps con su peso, cantidad de series válidas y suma de peso × reps. Si no hay ninguna serie válida, no se agrega un punto artificial de valor cero.
- Los récords se derivan de las series existentes en cada lectura reactiva. Empates de peso se desempatan por reps y empates de reps por peso; empates completos conservan la aparición más reciente. No hay estimaciones e1RM en la interfaz.
- El último entrenamiento registrado puede tener datos incompletos: se muestra para no ocultar lo que se anotó, pero sus series incompletas no participan en máximos. Se incluyen todas sus filas, con — para campos vacíos, y se ignoran ejercicios con todas las filas completamente vacías.

## Conservación y compatibilidad

No hay nueva versión Dexie ni migración de datos: se mantiene v2 y sus siete tablas. Las consultas de estadísticas se ejecutan en transacciones de solo lectura. Los snapshots siguen identificando el ejercicio histórico. El listado de progreso incluye identidades archivadas en snapshots, aunque no estén en la plantilla actual.

`isPr` se conserva en las filas antiguas y en los backups para compatibilidad, pero deja de gobernar insignias de la interfaz. Finalizar una sesión no reescribe series para marcar récords. Editar/eliminar una serie o sesión por una acción explícita del usuario actualiza automáticamente las referencias y las pantallas de evolución.

Se conservan íntegros los importadores v1/v2, la exportación v2, sus advertencias de reemplazo, validaciones y restauración atómica. Los backups v2 siguen sin ser importables por una app anterior v1; esta entrega no cambia esa limitación de Etapa 2. No se accede al almacenamiento del iPhone ni a su historial real. Las pruebas usan perfiles aislados y datos sintéticos.

## Interfaz

Paleta verde sobria, superficies consistentes y tipografía del sistema sin fuentes externas. Inicio con cuatro tarjetas de rutina, búsqueda de ejercicios para evolución, historial con filtros por día original/ejercicio/semana. Las referencias de último entrenamiento y los máximos se separan visualmente antes de los inputs.

El gráfico permite peso, reps, series y volumen, períodos 1/3/6 meses y todo el historial. Tocar/activar por teclado un punto muestra fecha, día original, nombre congelado y todas las series con RIR. Los botones del historial ofrecen la misma selección accesible. Una sesión eliminada desaparece del detalle; una edición actualiza sus valores.

Tema claro/oscuro recordado en `gym-tracker:theme:v1`; preferencia de sistema como valor inicial. Si falla localStorage, el tema cambia y se informa que no se pudo recordar. La preferencia no se incluye en los backups de entrenamientos. Se permite zoom y se conservan inputs de al menos 16 px y botones de al menos 44 px. El temporizador flota encima del botón inferior de finalizar. Los grupos de tres ejercicios distinguen inicio/medio/final, con registros independientes.

El service worker incrementa su caché a v4, conservando activación en espera, sin `skipWaiting`, `clients.claim` ni recargas forzadas. El aviso distingue instalación inicial de actualización y se oculta cuando ya no existe un worker esperando. No se promete un modo offline completo nuevo.

## Validación automatizada

- `npm test`: 60/60 pruebas en Chromium real con IndexedDB nativo. Incluye las 50 regresiones de Etapas 1 y 2 y diez nuevas pruebas de métricas, 0 kg, incompletos, sesiones activas/omitidas, identidades congeladas, no escritura en lecturas, récords tras edición/eliminación, finalización sin PR persistidos, interacción del gráfico, referencias reactivas, errores de lectura y temas con storage denegado.
- `npm run lint`, `npm run typecheck`, `git diff --check` y `npm run build`: comprobados localmente. El build estándar usa Turbopack; no se cambia a Webpack para desplegar.
- El despliegue de prueba requiere verificar equipo `bruno-1e73`, proyecto `gym-tracker-etapa1-test` (`prj_RiISqPbY7TMSpBhLhj1wyoQG7qwZ`), ausencia de integración Git y alias independiente. Se prepara un build sin mover el dominio estable, se prueba la URL candidata y luego se asigna exclusivamente el dominio de prueba.

Las comprobaciones remotas y el commit desplegado se entregan en el resumen del despliegue; no deben inferirse de los resultados locales.

## Validación física pendiente y riesgos

La emulación móvil Chromium no equivale a Safari/iOS. Antes de autorizar producción hay que verificar en el iPhone:

1. Abrir únicamente la URL de prueba. Exportar un backup sintético antes de actualizar. Cerrar todas las ventanas/PWA del origen de prueba y reabrir para activar la actualización pendiente.
2. Comprobar tema claro/oscuro tras cerrar/reabrir, contraste, zoom, teclado decimal y controles con una mano, en Safari y como PWA instalada.
3. Abrir los cuatro días sin generar sesiones; sustituir/agregar/omitir y registrar peso, reps y RIR, incluyendo peso 0. Verificar guardado y conservación del día original.
4. Terminar, revisar evolución en las cuatro métricas y tocar puntos para contrastar sus series completas, fecha y día.
5. Editar un máximo en el historial, volver al ejercicio y a la plantilla; comprobar que máximos y referencia cambian. Eliminar una sesión sintética y verificar su desaparición de los cálculos.
6. Exportar/restaurar JSON v2 y un v1 sintético; cancelar una restauración y rechazar un archivo corrupto; confirmar conservación de las filas.
7. Durante un entrenamiento de prueba, comprobar la espera de una actualización y que no se recarga automáticamente. Probar cerrar/reabrir y el temporizador en segundo plano.

iOS puede terminar la app antes de que IndexedDB confirme una escritura y `beforeunload` no es garantía. Se conserva el indicador de guardado/error y el bloqueo de finalización ante escrituras fallidas; no se afirma persistencia de texto todavía no confirmado tras un cierre forzado. Safari puede desalojar almacenamiento local: mantener backups externos verificados. No se implementa sincronización ni resolución de conflictos del mismo campo entre ventanas. En historiales muy grandes, las consultas y el listado completo pueden necesitar paginación futura; no se modifica el historial para optimizarlos.
