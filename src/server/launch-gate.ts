/** Free launches go through this gate one at a time, so two requests can't
 * both see an idle treasury and both spend it: the second one waits, then sees
 * the first launch holding the treasury and is turned away. One web process
 * serves launches, so an in-process queue is enough. */
let tail: Promise<unknown> = Promise.resolve();

export function oneLaunchAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.catch(() => undefined);
  return run;
}
