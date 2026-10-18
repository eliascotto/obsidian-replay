import { PLAYBACK_RATES } from './replay/types';

export const DEFAULT_DOOMED_COLOR = '#ffea00';

export function normalizeDoomedColor(value: unknown): string | undefined {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

/** Shared local preferences; recording files never contain UI settings. */
export class ReplayPreferences {
	private data: Record<string, unknown>;
	private rate = 1;
	private color = DEFAULT_DOOMED_COLOR;
	private doomed = false;
	private listeners = new Set<() => void>();
	private pending: Promise<void> = Promise.resolve();

	constructor(saved: unknown, private save: (data: Record<string, unknown>) => Promise<void>,
		private failed: () => void) {
		this.data = typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? { ...saved } : {};
		const rate = this.data.playbackRate;
		if (typeof rate === 'number' && PLAYBACK_RATES.includes(rate)) this.rate = rate;
		this.color = normalizeDoomedColor(this.data.doomedHighlightColor) ?? DEFAULT_DOOMED_COLOR;
		if (typeof this.data.doomedEnabled === 'boolean') this.doomed = this.data.doomedEnabled;
	}

	get playbackRate(): number { return this.rate; }
	get doomedHighlightColor(): string { return this.color; }
	get doomedEnabled(): boolean { return this.doomed; }
	subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

	setRate(rate: number): void {
		if (!PLAYBACK_RATES.includes(rate)) throw new RangeError('Unsupported playback rate.');
		if (rate === this.rate) return;
		this.rate = rate;
		this.update({ playbackRate: rate });
	}

	setDoomedColor(value: string): void {
		const color = normalizeDoomedColor(value);
		if (!color) throw new RangeError('Use a six-digit hex color.');
		if (color === this.color) return;
		this.color = color;
		this.update({ doomedHighlightColor: color });
	}

	setDoomedEnabled(enabled: boolean): void {
		if (typeof enabled !== 'boolean') throw new RangeError('Doomed must be enabled or disabled.');
		if (enabled === this.doomed) return;
		this.doomed = enabled;
		this.update({ doomedEnabled: enabled });
	}

	private update(changes: Record<string, unknown>): void {
		const data = this.data = { ...this.data, ...changes };
		// Serialize writes so a slower earlier save cannot overwrite the latest choice.
		this.pending = this.pending.then(() => this.save(data)).catch(() => this.failed());
		this.listeners.forEach((listener) => listener());
	}

	flush(): Promise<void> { return this.pending; }
}
