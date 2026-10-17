import type { ReplayController } from './controller';
import { compareDoomed, type DoomedComparison, type DoomedRange } from './doomed';

export const DOOMED_CACHE_LIMITS = Object.freeze({ entries: 16, ranges: 4096 });
export interface DoomedDisplay {
	readonly enabled: boolean;
	readonly ranges: readonly DoomedRange[];
	readonly message: string;
}
type Comparison = DoomedComparison | { readonly status: 'unavailable'; readonly reason: 'error' };
const noRanges: readonly DoomedRange[] = Object.freeze([]);

/** Transient presentation bound to one player at a time; no timers, subscriptions or vault access. */
export class DoomedPresentation {
	private player: ReplayController | undefined;
	private enabled = false;
	private cache = new Map<number, Comparison>();
	private rangeCount = 0;
	private last: { sequence: number; result: Comparison } | undefined;

	constructor(private compare = compareDoomed) {}

	bind(player: ReplayController | undefined): void {
		if (player === this.player) return;
		this.dispose();
		this.player = player;
	}

	toggle(): void { if (this.player) this.enabled = !this.enabled; }

	get display(): DoomedDisplay {
		if (!this.enabled || !this.player) return { enabled: false, ranges: noRanges, message: '' };
		const state = this.player.state;
		const result = this.result(state.sequence, state.text);
		return {
			enabled: true,
			ranges: result.status === 'ready' ? result.ranges : noRanges,
			message: result.status === 'unavailable' ? 'Doomed comparison is unavailable for this step.' : '',
		};
	}

	private result(sequence: number, text: string): Comparison {
		if (this.last?.sequence === sequence) return this.last.result;
		let result = this.cache.get(sequence);
		if (result) this.cache.delete(sequence);
		else {
			try { result = this.compare(text, this.player!.finalText); }
			catch { result = { status: 'unavailable', reason: 'error' }; }
			if (result.status === 'ready') this.rangeCount += result.ranges.length;
		}
		this.cache.set(sequence, result);
		while (this.cache.size > DOOMED_CACHE_LIMITS.entries || this.rangeCount > DOOMED_CACHE_LIMITS.ranges) {
			const oldest = this.cache.keys().next().value as number;
			const removed = this.cache.get(oldest)!;
			if (removed.status === 'ready') this.rangeCount -= removed.ranges.length;
			this.cache.delete(oldest);
		}
		this.last = { sequence, result };
		return result;
	}

	dispose(): void {
		this.player = undefined;
		this.enabled = false;
		this.cache.clear();
		this.rangeCount = 0;
		this.last = undefined;
	}
}
