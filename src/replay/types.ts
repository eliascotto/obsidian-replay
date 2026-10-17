import type { RecordingReference } from '../recording/replay-access';
import type { ReplayController } from './controller';

export const BASE_STEPS_PER_SECOND = 4;
export const PLAYBACK_RATES: readonly number[] = Object.freeze([0.5, 1, 2, 3, 4]);

export interface ReplayState {
	readonly sequence: number;
	readonly text: string;
	readonly lastSequence: number;
	readonly rate: number;
	readonly playing: boolean;
	readonly pendingSequence: number | null;
	readonly error: string | null;
}

export type ReplayStatus =
	| { readonly phase: 'idle'; readonly path: null }
	| { readonly phase: 'loading'; readonly path: string }
	| { readonly phase: 'unavailable'; readonly path: string; readonly message: string }
	| { readonly phase: 'ready'; readonly path: string; readonly reference: RecordingReference; readonly player: ReplayController };
