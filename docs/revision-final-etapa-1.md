# Revisión final de Etapa 1 — PR #1

## Conclusión

La rama está preparada para una prueba controlada en iPhone con datos sintéticos y un origen HTTPS aislado de la PWA diaria. No equivale a autorizar publicación ni merge. La validación física de Safari/PWA, la descarga y recuperación de un backup real y la transición de actualización instalada siguen siendo condiciones previas a publicar. No se desplegó ni fusionó el PR, y no se implementó Etapa 2.

## Hallazgos reproducidos y correcciones

### Backups v1: datos válidos frente a inconsistencias

Se revisó el exportador, los tipos y las operaciones de escritura de `main` (`542edca`). Exportaba las cuatro tablas sin normalizar valores ni exigir entrenamientos terminados. La revisión anterior ya admitía nulos y ceros en series, pero rechazaba un caso válido: si el reloj retrocedía entre inicio y fin, el original conservaba ambos timestamps y guardaba duración cero mediante `Math.max(0, elapsed)`. Una regresión falló con ese archivo; se retiró la restricción que imponía fin >= inicio. No se modifican ni corrigen esas fechas al importar.

Aceptado y probado:

- JSON v1 vacío; catálogo sin historial; sesión activa con `finishedAt: null`, `duration: null` y notas nulas o vacías.
- Las 27 combinaciones de peso/repeticiones/RIR nulos, ceros o valores positivos; decimales en peso/RIR.
- Sesión exportada antes de crear sus ejercicios, ejercicios sin series, series incompletas y sesión finalizada sin series. No se exige completar la rutina ni las tres series iniciales.
- Numeración con huecos tras eliminar series; no se renumera.
- Timestamps de fin anteriores al inicio por cambio de reloj, con duración cero.
- Todos los campos de la fixture v1, IDs, notas, PRs, ceros y nulos se conservan. Una restauración con catálogo reducido permite comenzar otro día agregando únicamente definiciones faltantes.

Rechazado sin escritura: JSON corrupto, versión desconocida, campos obligatorios ausentes, tipos incorrectos, números negativos/no finitos, fechas inválidas, metadatos ISO de semana incompatibles, IDs duplicados, referencias huérfanas, ejercicio duplicado en un entrenamiento, números de serie duplicados y múltiples sesiones activas. La aplicación original podía exportar algunas de esas inconsistencias por sus carreras o por aceptar importaciones sin validación; que un archivo haya sido exportado por ella no prueba que sea íntegro. No se borran ni reparan sus registros automáticamente: se conserva el archivo original para diagnóstico específico.

No se añadió una condición nueva que requiera que una serie esté completa para poder restaurarla; tampoco se reinterpretan ceros como omisiones ni se cambian estadísticas.

### Restauración: consentimiento y copia previa

El selector solo valida y presenta el contenido. `RestoreConfirmation` muestra explícitamente que reemplaza todo el historial, ofrece descargar la copia actual y exige un paso adicional: escribir exactamente `REEMPLAZAR` y luego pulsar “Reemplazar historial”. Cancelar no modifica la base.

La descarga no se presenta como una copia verificada: los navegadores no permiten probar que el archivo efectivamente quedó guardado en Archivos. Por eso se eligió una confirmación adicional obligatoria incluso después de solicitar la descarga, con advertencia explícita del riesgo de continuar sin copia previa verificada. No se exige disponer ya de otra copia como condición absoluta de uso.

El servicio `importBackup` también rechaza llamadas sin los dos consentimientos explícitos. Después valida un snapshot separado del objeto del llamador, espera escrituras pendientes y usa la transacción de reemplazo existente. Fallos tras `clear` o durante inserciones revierten las cuatro tablas. El código de consentimiento es una defensa contra llamadas accidentales; no es una barrera frente a código malicioso con acceso al mismo origen.

### Autoguardado: orden efectivo, no solo mensajes

Se reprodujo una escritura antigua que se demoraba antes de acceder a IndexedDB y sobrescribía una edición posterior. Las revisiones del primer PR solo protegían feedback, no el orden de las operaciones. Ahora `persist` ejecuta FIFO por serie: peso, reps, RIR y eliminación comparten una cola. Un fallo no detiene reintentos posteriores; los errores se mantienen por campo, y completar otro campo no los oculta.

Se mantienen las revisiones del formulario para no descartar un borrador nuevo cuando termina una operación antigua, incluidos cambios A-B-A. El borrado espera las ediciones previas, deshabilita la fila y solo descarta sus errores si fue exitoso. Si falla, conserva los datos, muestra el error por separado del estado de guardado de los campos y permite reintentar. Una edición posterior exitosa no oculta un fallo de eliminación.

`finishSession` espera escrituras incluso si se llama fuera del componente; no finaliza si quedan errores. Al reconsultar una finalización histórica no escribe PRs, fecha ni duración: se encontró y corrigió una actualización redundante que podía recalcular una duración histórica. Se prueba que esa llamada funciona aun cuando un hook rechaza cualquier actualización de `workoutSessions`.

Se agregó una advertencia `beforeunload` mientras haya operaciones pendientes o fallidas. Es una ayuda cuando el navegador emite ese evento, no una garantía para iPhone: iOS puede suspender o terminar la PWA sin emitirlo. No hay debounce ni guardado diferido a unload. Esperar “Guardado” antes de cerrar sigue siendo necesario. Los borradores de campos fallidos son memoria de la pantalla y no sobreviven a la terminación del proceso.

La garantía FIFO corresponde a operaciones en un mismo contexto de la app. No se incorporó resolución de conflictos del mismo campo entre ventanas independientes: allí sigue prevaleciendo la última escritura que llega a la base. Las transacciones de creación de sesiones/numeración sí protegen múltiples contextos; las pruebas originales entre dos contextos se mantienen. En la prueba controlada usar una sola ventana de entrenamiento.

### Service worker y actualización mínima

El worker original llamaba `skipWaiting`, tomaba clientes con `clients.claim`, borraba cualquier caché del origen y almacenaba respuestas dinámicas de Next junto con otras solicitudes GET. Eso permitía cambiar de worker durante una sesión abierta y mezclar respuestas HTML/RSC en caché.

Correcciones mínimas implementadas, sin nuevas tablas ni motor offline:

- Nuevo caché `rutina-bruno-v2`, separado del worker anterior. Aumentar su versión cuando se cambie el worker/contrato de caché en otra publicación.
- Instalación en espera natural; sin `skipWaiting`, mensajes para forzar activación, `clients.claim` ni recarga automática de páginas abiertas.
- Aviso de actualización preparada: terminar y guardar, cerrar **todas** las ventanas/PWA de ese origen y volver a abrir. Una ventana abierta en segundo plano también puede mantener el worker anterior.
- Limpieza limitada a cachés con el prefijo propio `rutina-bruno-`; IndexedDB no se toca.
- Caché de recursos restringida a estáticos de Next, iconos y manifest. No se almacenan respuestas de rutas/RSC como documentos. Las navegaciones solo guardan HTML exitoso en el caché propio.

La prueba de ciclo real usa una fixture del worker original de main, mantiene un cliente controlado por él, instala el worker corregido y verifica que espere, que el cliente no se recargue/cambie de controlador y que se active después de cerrar ese cliente. Ya activo, verifica que no almacene RSC y conserve una caché ajena.

Un worker ya activo conserva su comportamiento viejo hasta que se cierre su último cliente. Esta corrección no puede cambiar el código que ya corre en el iPhone sin instalar y activar la actualización. El primer cambio deberá hacerse **fuera de un entrenamiento**, después de exportar y verificar una copia. No se promete que toda navegación, recarga o ruta dinámica funcione offline ni que el servidor conserve indefinidamente chunks antiguos; eso requiere una revisión offline más amplia. La transición real Safari instalada aún debe probarse.

## Preservación de historial, rutina y estadísticas

No hay upgrade de Dexie, nuevas tablas/campos históricos, `deleteDatabase`, reinicialización ni normalización automática. Nombre, esquema e índices de la base y formato v1 siguen iguales. Arrancar la aplicación no modifica filas de entrenamientos, ejercicios realizados ni series existentes. Editar, borrar y reemplazar mediante acciones explícitas conserva los flujos autorizados de la app.

`git diff origin/main` confirma que `src/data/routine.ts`, `src/lib/calculations.ts`, `src/lib/types.ts` y `src/app/progreso/page.tsx` permanecen idénticos. Se mantienen el criterio de series válidas, las fórmulas y el comportamiento normal de PRs. Se añadieron controles de escritura y preservación al repetir una finalización, sin recalcular el historial.

## Resultados comprobados

| Validación | Resultado |
| --- | --- |
| `npm test` | 32/32 aprobadas, Chromium con IndexedDB real y perfil temporal |
| `npm run lint` | Aprobado |
| `npm run typecheck` | Aprobado |
| `npm run build -- --webpack` | Producción compilada correctamente |
| `npm run build` (Turbopack) | Falló: PostCSS/proceso interno no puede abrir un puerto, `Operation not permitted` del entorno |
| `git diff --check` | Sin errores |
| Rutina, tipos, cálculos y progreso comparados con main | Sin diferencias |

No se declara Turbopack aprobado. Las pruebas de navegador verifican secuencias y efectos en Chromium, no la implementación de Safari. Las pruebas usan únicamente datos sintéticos, un perfil efímero y un servidor local; nunca accedieron a IndexedDB, cachés o archivos de la PWA diaria.

## Condiciones para prueba en iPhone y publicación

Prueba controlada pendiente, sin utilizar el origen de producción: build de esta rama en un origen HTTPS aislado accesible desde el iPhone; una sola ventana de entrenamiento; datos sintéticos y una copia del historial real conservada fuera de la PWA. No se creó ni desplegó ese entorno en esta revisión. La configuración de Vercel de la rama continúa deshabilitando despliegues Git.

Antes de autorizar publicación, registrar versión de iOS y Safari y completar:

1. Instalar la versión original en el entorno de prueba, crear historial sintético y exportar a Archivos. Abrir el JSON, comprobar contenido e importarlo de vuelta en el entorno aislado. Guardar además una copia real de producción externamente sin restaurarla durante esta prueba.
2. Editar rápidamente peso, reps y RIR, incluyendo coma, ceros, campos vacíos y A-B-A. Finalizar inmediatamente tras editar y verificar todos los valores al reabrir.
3. Reproducir un error de cuota/almacenamiento de forma controlada; comprobar error visible, texto conservado, reintento y finalización bloqueada. Borrar con escritura pendiente y comprobar resultado tras reabrir.
4. Pasar a segundo plano, bloquear/desbloquear, volver y cerrar/reabrir. Registrar qué ocurre al terminar el proceso antes y después de “Guardado”; no prometer recuperación de borradores en memoria.
5. Cancelar una importación, probar un archivo inválido y una restauración válida con entrenamiento incompleto. Comprobar la advertencia, copia previa, frase adicional y conservación ante fallo. No provocar fallos sobre el historial diario.
6. Con la PWA original abierta y una sesión activa, ofrecer la versión nueva en ese entorno aislado: comprobar que no cambie de worker ni recargue sola. Guardar y finalizar, cerrar todas las ventanas, reabrir y verificar activación e historial intacto; comprobar con y sin conexión los recorridos que ya funcionaban offline.
7. Obtener compilación estándar en un entorno sin la restricción de puertos, o acordar explícitamente usar la compilación webpack ya validada. Revisar PR completo y autorizar merge/publicación por separado.

No se autoriza ni ejecuta una publicación automática al finalizar esta revisión.
