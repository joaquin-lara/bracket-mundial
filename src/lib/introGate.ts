// One shared decision: the home intro plays on the first full load of the
// site, not on every navigation back to the home tab. Module state resets on
// a hard reload (F5), which intentionally replays the show.

let playedOnce = false;
let lastDecision = true;
let lastAt = 0;

/**
 * Called by GlobeBackdrop (the intro's orchestrator) once per home mount.
 * The 1s window makes React strict-mode double-mounts and sibling reads
 * within the same navigation agree on the same answer.
 */
export function decideIntro(): boolean {
  const now = Date.now();
  if (now - lastAt < 1000) return lastDecision;
  lastAt = now;
  lastDecision = !playedOnce;
  playedOnce = true;
  return lastDecision;
}

/** Same answer, for sibling components (HomeIntro). */
export function introDecision(): boolean {
  return lastDecision;
}
