import { PLAYBACK_RATES } from './replay/types';

/** Shared local preferences; recording files never contain UI settings. */
export class ReplayPreferences {
	private data: Record<string, unknown>;
	private rate = 1;
	private listeners = new Set<() => void>();
	private pending: Promise<void> = Promise.resolve();

	constructor(saved: unknown, private save: (data: Record<string, unknown>) => Promise<void>,
		private failed: () => void) {
		this.data = typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? { ...saved } : {};
		const rate = this.data.playbackRate;
		if (typeof rate === 'number' && PLAYBACK_RATES.includes(rate)) this.rate = rate;
	}

	get playbackRate(): number { return this.rate; }
	subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

	setRate(rate: number): void {
		if (!PLAYBACK_RATES.includes(rate)) throw new RangeError('Unsupported playback rate.');
		if (rate === this.rate) return;
		this.rate = rate;
		const data = this.data = { ...this.data, playbackRate: rate };
		// Serialize writes so a slower earlier save cannot overwrite the latest choice.
		this.pending = this.pending.then(() => this.save(data)).catch(() => this.failed());
		this.listeners.forEach((listener) => listener());
	}

	flush(): Promise<void> { return this.pending; }
}
