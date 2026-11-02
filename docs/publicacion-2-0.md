# Gym-tracker 2.0: preparación, publicación y recuperación

Estado: preparado para revisión; **no autoriza ni ejecuta fusiones ni despliegues**. El usuario confirmó en iPhone las funciones de Etapas 2, 3 y 4. La actualización posterior de dependencias está probada automáticamente; no se declara que esa nueva combinación ya se probó físicamente en su iPhone.

## 1. Candidato y dependencias

Rama `release/gym-tracker-2-readiness`, basada exactamente en `2cabfd412f644c02fd92e4fef2534950b09914e1` del PR #3. Contiene todas las Etapas 2–4 sin modificar su código de aplicación, rutina, IDs, esquema Dexie ni validación de backups.

| Paquete | Antes | Candidato | Motivo |
| --- | --- | --- | --- |
| next | 16.3.5 | 16.4.4 | Versión estable corregida de la misma versión mayor; cubre avisos de ejecución de código, caché, imágenes y Server Actions del informe inicial |
| eslint-config-next / plugin de Next | 16.3.5 | 16.4.4 | Mantener configuración alineada con Next |
| sharp | 0.35.4 | 0.35.5 | Corrección de librsvg CVE-2026-96889 |
| source-map-js | 1.2.1 | 1.2.2 | Corrección de denegación de servicio, GHSA-68fv-2mgg-jv7q |
| zod | 4.6.5 | 4.6.7 | Corrección de consumo de memoria, GHSA-mrhx-c7xc-m3w5 |

Las tres dependencias transitivas se actualizan en el lockfile dentro de sus rangos compatibles. No se agrega ninguna dependencia ni override que fuerce una versión mayor incompatible. `npm ci` instala el candidato de forma reproducible.

Auditoría ejecutada el 2026-11-02:

- Antes: 26 entradas (1 crítica, 9 altas, 16 moderadas).
- Después, árbol completo: **0 críticas, 0 altas, 18 moderadas**.
- Después, `npm audit --omit=dev`: **0 vulnerabilidades**.
- Las 18 entradas moderadas son propagaciones del aviso `minimatch` GHSA-g3hv-75wg-m249 en herramientas de lint. ESLint 9 y plugins import/jsx-a11y todavía requieren minimatch 3; typescript-eslint usa 10. El aviso declara afectadas las versiones <11.0.1. La rama legacy-v3 publicada sigue en 3.1.5. Forzar minimatch 11 cambia la API y salta fuera de los rangos de esos consumidores: no se presenta como corrección compatible. No se ejecutó `npm audit fix --force`.
- Este límite de herramientas queda abierto y debe revisarse con futuras versiones upstream. No se afirma una auditoría total sin alertas ni ausencia de vulnerabilidades desconocidas. Las rutas de estas herramientas no forman parte de las dependencias runtime auditadas; lint solo se ejecuta sobre código revisado del repositorio.

## 2. Validación del candidato

Comprobado en Linux / Node 24 con perfiles Chromium temporales e IndexedDB real:

- `npm ci`, TypeScript, lint, `git diff --check`, build estándar `npm run build` con Turbopack.
- Smoke test de la aplicación compilada con `next start`: nueve rutas principales renderizadas sin excepciones de runtime; abrir los cuatro días no crea sesiones.
- `npm test`: **64/64**. Conserva las 60 pruebas de Etapas 1–4 y suma cuatro de publicación.
- Migración nativa v1→v2 con varios entrenamientos, días originales, entrenamiento activo, ejercicios archivados, notas de sesión y de ejercicio, acentos/saltos de línea, decimales, RIR 0/null/decimal, peso corporal, repeticiones 0 y campos vacíos. Comparación exacta de las cuatro tablas originales.
- Fallo inyectado después de comenzar a insertar snapshots: revierte la versión, elimina las tablas nuevas de esa transacción y conserva todas las filas v1. El reintento compatible crea v2 sin duplicaciones ni modificaciones históricas.
- Una apertura nativa v1 (versión 10) después del upgrade a v2 (versión 20) falla con `VersionError`. Reabrir con código v2 conserva todas las filas. **Rollback de código no es downgrade de datos.**
- Importación de backup v1, exportación/importación v2, conservación de snapshots, catalogación de ejercicios archivados y nuevas plantillas sin historia ficticia. Las regresiones anteriores cubren archivos corruptos, restauración fallida con rollback de siete tablas, concurrencia y errores de almacenamiento.
- El ejercicio histórico `d1-1a` conserva entrenamientos de sus días originales aunque la plantilla actual lo ubique en Día 2. Ejercicios sustitutos usan su identidad real. Los IDs antiguos que ya no están en la plantilla siguen siendo consultables. No se fusionan identidades por nombre ni se asigna pasado a ejercicios nuevos.

No se accedió a historial personal. Estas pruebas demuestran compatibilidad con el formato y casos ensayados; no certifican byte por byte una base real que no se inspeccionó. No se reconstruyen metadatos que la aplicación antigua ya hubiera sobrescrito, ni se corrigen posibles errores humanos.

El build remoto de esta actualización en el proyecto Vercel de producción **no se ejecutó**: requeriría crear un deployment y el usuario todavía no lo autoriza. El build local usa el comando estándar y Node 24, igual a la versión Node configurada en Vercel. La validación física posterior a actualizar dependencias y la comprobación del futuro build remoto siguen siendo controles del proceso de publicación.

## 3. Integración secuencial, todavía sin ejecutar

Referencias revisadas:

1. `main`: `69eaac3c05f31df588fbd141be6b250ddea3575b`.
2. PR #2: `90720d39e5352b68aa0b8541679d8b8f55edbcdc`, base main.
3. PR #3: `2cabfd412f644c02fd92e4fef2534950b09914e1`, base rama del PR #2.
4. Rama de preparación: contiene el PR #3 más las dependencias corregidas, pruebas y este procedimiento. Se revisa en un PR adicional apilado sobre #3.

Se comprobó que main es ancestro de #2 y #2 es ancestro de #3. El ensayo `git merge-tree` de main→#2 produce el árbol exacto de #2 (`a85b845db0e3f9061ff192f42ac782c40948c040`); el de #2→#3 produce el árbol exacto de #3 (`fed2db7e3b80aad16bf6f0a2575d9bccc5ddf366`). Sin conflictos. El candidato ya contiene ambos árboles integrados y sus pruebas pasan.

Después de autorización explícita:

1. Volver a verificar que los SHA no cambiaron y que `git.deploymentEnabled: false` continúa en main y en cada PR. Si cambiaron, repetir la revisión.
2. Fusionar #2 hacia main usando merge commit, conservando la ascendencia. No hacer squash/rebase de este conjunto apilado sin recalcular las bases.
3. Retargetear #3 a main; verificar el diff y volver a comprobar pruebas sobre la integración real; fusionarlo con merge commit.
4. Retargetear el PR de preparación a main, comprobar que solo agrega seguridad/pruebas/documentación y fusionarlo. No publicar el main intermedio con dependencias vulnerables.
5. Ejecutar instalación limpia, auditorías, las 64 pruebas, TypeScript, lint y build del SHA final. Registrar ese SHA como única fuente del despliegue manual.

No se modifica el estado borrador de #2/#3 ni sus ramas durante esta preparación. La aprobación funcional anterior no se interpreta como autorización de merge o publicación.

## 4. Destino Vercel y despliegue manual futuro

Datos verificados por consultas de solo lectura:

- Equipo Bruno, slug `bruno-1e73`, ID `team_sATL8PDCDA0xPuzbqboloBmi`.
- Proyecto de producción `gym-tracker`, ID `prj_78KrSrwnVwG9gGl3Rtj0SPWr962B`, framework Next.js, Node `24.x`.
- Dominio HTTPS `gym-tracker-peach-eta.vercel.app`, verificado, sin redirect; pertenece a ese proyecto.
- Deployment actual READY: `dpl_GTANFiXs3eiz6Pyt6Y3cDXmVP4a7`, fuente `542edca69137d637fcf7a02296cfe620558deb5d`.
- `vercel.json` en main conserva `git.deploymentEnabled: false`; el candidato hereda exactamente esa configuración. No se habilitan despliegues automáticos.
- La herramienta de consulta de proyecto no expone todos los overrides de build/install del dashboard. No se interpreta la ausencia de esos campos como prueba de su valor. El futuro deployment manual debe fijar explícitamente `npm ci`, `npm run build`, Node 24 y framework Next.js, sin cambiar ahora el proyecto.

Las herramientas disponibles permiten crear un deployment manual desde los archivos de un SHA exacto y promoverlo. No se ensayó una publicación para probar permisos: su ejecución queda condicionada a la autorización final y a la respuesta efectiva de Vercel.

Proceso que ejecutaré después de la autorización:

1. Registrar destino, SHA, deployment actual y estado de dominios; comprobar otra vez el destino justo antes de cada mutación.
2. Preparar un deployment del proyecto `gym-tracker` para el entorno production **sin asignar todavía sus dominios** (desactivar temporalmente la asignación automática solo durante esa operación, con restauración del ajuste al terminar). Esto no significa habilitar Git deployments. No usar el proyecto de prueba como destino de producción ni mezclar sus IndexedDB por origen.
3. Subir únicamente archivos de aplicación del SHA final, sin backups, historial, `.env`, perfiles de navegador o archivos de trabajo. Fijar comandos estándar. Verificar build Turbopack READY y SHA.
4. En la URL candidata, probar con un perfil limpio y datos sintéticos: apertura de días, guardado/reapertura, migración v1, backups y consultas. La migración real del iPhone sucede en su navegador al abrir el dominio original, nunca en un servidor Vercel.
5. Si cualquier control falla, no mover el dominio original; corregir y volver a validar. No pedir al usuario abrir una candidata con su historial personal.
6. Promover exclusivamente el deployment validado al dominio original. Verificar alias, HTTPS y versión. Mantener el dominio original para conservar el origen de IndexedDB. No agregar redirecciones ni cambiar dominio.
7. Restaurar la asignación de dominios según el estado previo y conservar el bloqueo Git. Acompañar al usuario en la primera apertura/migración, sin solicitar su backup personal.

## 5. iPhone: antes y después

Antes, mientras producción todavía es v1:

1. Terminar el entrenamiento y comprobar que los últimos valores aparecen al reabrirlo. No empezar otro durante la ventana de publicación.
2. En la **PWA habitual de producción**, exportar un JSON v1 con su función de backup. Guardarlo en Archivos y una segunda copia privada (por ejemplo iCloud Drive). Confirmar que existe, tiene tamaño mayor que cero y corresponde a la fecha actual. Conservar ambas copias sin editarlas y sin subirlas al repositorio, chat o proyecto de prueba. Una descarga solicitada no equivale a un archivo verificado.
3. Anotar privadamente algunos controles: cantidad de entrenamientos si está disponible y una sesión antigua y la última (fecha, día, ejercicio, series, RIR y notas). No enviar su contenido al agente.
4. Cerrar todas las ventanas Safari del dominio y la PWA desde el selector. No desinstalar la PWA, borrar datos de Safari ni eliminar IndexedDB. Mantener espacio libre y conexión durante la primera apertura.

Después de avisar que se publicó:

1. Abrir la misma PWA y el mismo dominio `gym-tracker-peach-eta.vercel.app`. Safari y PWA pueden usar contenedores distintos: no asumir que abrir otra ventana, otro navegador o reinstalar comparte el historial anterior.
2. Si aparece la actualización en espera, cerrar todas las ventanas de ese origen y volver a abrir. No forzar una recarga durante un entrenamiento ni borrar cachés/datos para actualizar. No se promete que un service worker controle instantáneamente todas las ventanas.
3. Esperar la apertura. Revisar primero las sesiones de control, incluidas notas y campos vacíos/0, y confirmar sus días originales. Verificar que los ejercicios nuevos no muestran entrenamientos inventados y que los antiguos siguen en historial/progreso.
4. Antes de registrar nuevos datos, exportar un backup v2 y guardar/verificar el archivo junto con el v1. Conservar ambos: el v2 no se importa en la app v1.
5. Recién entonces empezar un entrenamiento. Confirmar Guardado; finalizar y revisar el historial. Exportar periódicamente backups v2 externos. Si falta algo o hay un error de apertura, detener nuevas anotaciones y seguir recuperación.

## 6. Recuperación: decisiones según el estado real

### A. Falló el build o la candidata antes de promover

El dominio original no se movió: continuar con el deployment antiguo, restaurar cualquier ajuste temporal de asignación de dominios y corregir el candidato. El iPhone no recibió la nueva app y no se toca su base.

### B. Se abortó la transacción v1→v2

La prueba nativa demuestra rollback completo a v1 ante un fallo dentro del upgrade, incluso después de comenzar a insertar snapshots. No borrar/reinicializar. Cerrar otras ventanas, comprobar espacio y reintentar la app compatible. Si el fallo persiste, preparar una corrección hacia adelante que pueda abrir v1 y completar v2; conservar el backup v1 externo.

Si se decide devolver el tráfico al deployment original, **primero confirmar que la base afectada sigue siendo v1 y que no existen clientes ya migrados**. No deducirlo solo del mensaje genérico de error: el fallo podría haber ocurrido después del upgrade. Las pruebas ya demostraron que un bundle v1 no abre una base v2.

### C. La base ya está en v2, o no se conoce su estado

No usar el deployment v1 como solución de datos. Mantener/publicar una corrección compatible con v2 en el mismo origen; debe abrir v1 y v2 sin cambiar IDs ni ejecutar un downgrade. Si la interfaz todavía funciona, exportar primero el v2 actual para conservar también lo anotado después de migrar.

Si hay que restaurar: elegir un backup privado validado, conservar otra copia del estado actual cuando pueda exportarse y usar el importador v2 con advertencia de reemplazo y confirmación explícita. Restaurar v1 en la app v2 recupera sus filas originales y genera snapshots; **no baja el esquema a v1**. Restaurar un backup previo reemplaza el historial y excluye anotaciones posteriores; no hacerlo automáticamente. Un archivo rechazado o una transacción fallida no reemplazan parcialmente el historial.

No convertir manualmente un v2 en v1 quitando campos; no borrar IndexedDB para conseguir que el bundle anterior arranque. Si la app no puede exportar, preservar el contenedor local y preparar una herramienta/corrección de lectura/exportación compatible, sin pedir subir los datos personales. No prometer recuperación automática de datos desalojados por iOS o de escrituras que nunca se confirmaron; las copias externas son la protección en esos casos.

### D. Revertir únicamente el tráfico de Vercel

La herramienta disponible `request_rollback`, con equipo y proyecto anteriores y destino `dpl_GTANFiXs3eiz6Pyt6Y3cDXmVP4a7`, permite solicitar el retorno de tráfico al deployment anterior. No se ejecutó. No se hace downgrade de bases, no se desinstalan service workers ni se reemplaza automáticamente un cliente abierto. El bundle antiguo además conserva dependencias anteriores.

Por eso ese rollback se reserva para una publicación que aún no recibió clientes migrados o una contingencia explícitamente evaluada. Una vez que haya v2, el camino principal es una corrección hacia adelante compatible. Si no se puede saber si ya hay usuarios migrados (los datos son locales), asumir que puede haberlos.

## 7. Condiciones de aprobación final

Los PR están preparados técnicamente y sin conflictos en los SHA revisados. Falta autorización explícita para integrarlos y para crear/promover un deployment. La publicación debe incluir el PR de seguridad y nunca detenerse en el main intermedio vulnerable.

Antes de mover el dominio: backup v1 privado verificado por el usuario, estado de referencias sin cambios, build remoto READY, prueba de la candidata con datos sintéticos y revisión consciente del aviso moderado residual de herramientas. Después: comprobación privada de sesiones reales y backup v2 en el iPhone. La confirmación funcional previa de Etapas 3/4 se conserva; no se declara ejecutado un nuevo ensayo físico tras actualizar Next.
