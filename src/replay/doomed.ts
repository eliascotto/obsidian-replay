export interface DoomedRange {
	readonly from: number;
	readonly to: number;
}

export type DoomedComparison =
	| { readonly status: 'ready'; readonly ranges: readonly DoomedRange[] }
	| { readonly status: 'unavailable'; readonly reason: 'work-limit' };

// Limits apply to one comparison, not the length of the recording.
export const DOOMED_LIMITS = Object.freeze({ inputUnits: 500_000, work: 500_000, traceCells: 131_072 });
const unavailable: DoomedComparison = Object.freeze({ status: 'unavailable', reason: 'work-limit' });
const empty: DoomedComparison = Object.freeze({ status: 'ready', ranges: Object.freeze([]) });

function ready(ranges: DoomedRange[]): DoomedComparison {
	return Object.freeze({ status: 'ready', ranges: Object.freeze(ranges.map((range) => Object.freeze(range))) });
}

/** Exact historical-side deletions from a bounded, code-point Myers comparison. */
export function compareDoomed(selectedText: string, finalText: string): DoomedComparison {
	if (selectedText === finalText || selectedText.length === 0) return empty;
	if (finalText.length === 0) return ready([{ from: 0, to: selectedText.length }]);
	if (selectedText.length + finalText.length > DOOMED_LIMITS.inputUnits) return unavailable;
	const before = Array.from(selectedText);
	const after = Array.from(finalText);
	const offsets = [0];
	for (const point of before) offsets.push(offsets[offsets.length - 1]! + point.length);
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let end = before.length;
	let afterEnd = after.length;
	while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end--; afterEnd--; }
	if (end === start) return empty;
	if (afterEnd === start) return ready([{ from: offsets[start]!, to: offsets[end]! }]);
	const deleted = deletedPoints(before.slice(start, end), after.slice(start, afterEnd));
	if (deleted === null) return unavailable;
	const ranges: DoomedRange[] = [];
	for (const index of deleted) {
		const from = offsets[start + index]!;
		const to = offsets[start + index + 1]!;
		const previous = ranges[ranges.length - 1];
		if (previous?.to === from) ranges[ranges.length - 1] = { from: previous.from, to };
		else ranges.push({ from, to });
	}
	return ready(ranges);
}

/** Each trace layer stores only its d+1 reachable diagonals, rather than a full matrix. */
function deletedPoints(before: string[], after: string[]): number[] | null {
	const trace: Int32Array[] = [];
	let cells = 0;
	let work = 0;
	for (let depth = 0; depth <= before.length + after.length; depth++) {
		cells += depth + 1;
		if (cells > DOOMED_LIMITS.traceCells) return null;
		const layer = new Int32Array(depth + 1);
		const previous = trace[depth - 1];
		for (let index = 0; index <= depth; index++) {
			if (++work > DOOMED_LIMITS.work) return null;
			const diagonal = 2 * index - depth;
			// On equal frontier positions prefer deletion, consistently with backtracking.
			const insert = index === 0 || (index !== depth && previous![index - 1]! < previous![index]!);
			let x = depth === 0 ? 0 : insert ? previous![index]! : previous![index - 1]! + 1;
			let y = x - diagonal;
			while (x < before.length && y < after.length && before[x] === after[y]) {
				if (++work > DOOMED_LIMITS.work) return null;
				x++; y++;
			}
			layer[index] = x;
			if (x >= before.length && y >= after.length) {
				trace.push(layer);
				return backtrack(trace, before.length, after.length);
			}
		}
		trace.push(layer);
	}
	return null;
}

function backtrack(trace: Int32Array[], x: number, y: number): number[] {
	const deleted: number[] = [];
	for (let depth = trace.length - 1; depth > 0; depth--) {
		const diagonal = x - y;
		const index = (diagonal + depth) / 2;
		const previous = trace[depth - 1]!;
		const insert = index === 0 || (index !== depth && previous[index - 1]! < previous[index]!);
		const previousDiagonal = diagonal + (insert ? 1 : -1);
		const previousX = previous[insert ? index : index - 1]!;
		const previousY = previousX - previousDiagonal;
		while (x > previousX && y > previousY) { x--; y--; }
		if (!insert) deleted.push(x - 1);
		x = previousX; y = previousY;
	}
	return deleted.reverse();
}
