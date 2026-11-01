// Writes begin on input, without a debounce or reliance on pagehide/unload (iOS can suspend).
const pending = new Set<Promise<unknown>>();
const failures = new Map<string, unknown>();
const revisions = new Map<string, number>();
export function persist<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  const promise = Promise.resolve().then(operation);
  pending.add(promise);
  promise.then(() => {
    pending.delete(promise);
    if (revisions.get(key) === revision) failures.delete(key);
  }, error => {
    pending.delete(promise);
    if (revisions.get(key) === revision) failures.set(key, error);
  });
  return promise;
}
export async function waitForWrites(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
  if (failures.size) throw new Error("Hay cambios sin guardar. Corregí los campos o reintentá antes de continuar.");
}
