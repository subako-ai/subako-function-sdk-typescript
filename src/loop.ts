// What the runtime waits on between stdin lines. After each line it runs the
// jobs that line started, then asks `__subako_tick` whether to run timers,
// sleep until the next one, or read on. It sleeps only while a request is
// still being answered, so a timer left behind (a forgotten interval, a
// library's keep-alive) never holds the module open.

type Id = string | number;

interface Timer {
	at: number;
	every: number | undefined;
	run: () => void;
}

const timers = new Map<number, Timer>();
let nextId = 1;

/** Requests being answered, each with what to send if nothing can settle it. */
const waiting = new Map<Id, () => void>();

export function setTimer(run: () => void, ms: unknown, repeat: boolean): number {
	const id = nextId++;
	const delay = Math.max(0, Number(ms) || 0);
	timers.set(id, { at: Date.now() + delay, every: repeat ? delay : undefined, run });
	return id;
}

export function clearTimer(id: unknown): void {
	if (typeof id === "number") timers.delete(id);
}

/** Notes that request `id` is being answered; `stuck` answers it if nothing can. */
export function awaitAnswer(id: Id, stuck: () => void): void {
	waiting.set(id, stuck);
}

/** Notes that request `id` is answered, and says whether it was still waiting. */
export function answered(id: Id): boolean {
	return waiting.delete(id);
}

/** 0 to run jobs again, a delay in ms to sleep first, or -1 to read the next line. */
export function tick(now = Date.now()): number {
	let ran = false;
	// A snapshot: a timer set while these run waits for the next tick, so a
	// chain of zero-delay timers cannot keep this loop from returning.
	for (const [id, timer] of Array.from(timers)) {
		if (timer.at > now) continue;
		ran = true;
		if (timer.every === undefined) timers.delete(id);
		else timer.at = now + timer.every;
		try {
			timer.run();
		} catch (error) {
			console.error(error);
		}
	}
	if (ran) return 0;
	if (waiting.size === 0) return -1;
	let next: number | undefined;
	for (const timer of timers.values()) next = next === undefined ? timer.at : Math.min(next, timer.at);
	if (next !== undefined) return Math.max(0, next - now);
	// Jobs and timers are all done, so nothing can answer these any more.
	for (const [id, stuck] of waiting) {
		waiting.delete(id);
		stuck();
	}
	return 0;
}
