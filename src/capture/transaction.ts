import type { Transaction } from '@codemirror/state';
import type { Observation } from '../recording/session';
import type { TextChange } from '../recording/types';

export function transactionObservation(transaction: Transaction): Observation | null {
	if (!transaction.docChanged || transaction.startState.doc.eq(transaction.newDoc)) return null;
	const changes: TextChange[] = [];
	// CodeMirror's default iterator combines adjacent changes into canonical ranges.
	transaction.changes.iterChanges((fromBefore, toBefore, fromAfter, toAfter, inserted) => {
		changes.push({
			fromBefore, toBefore, fromAfter, toAfter,
			deletedText: transaction.startState.doc.sliceString(fromBefore, toBefore),
			insertedText: inserted.toString(),
		});
	});
	return { before: transaction.startState.doc.toString(), after: transaction.newDoc.toString(), changes };
}

/** One router per editor: rebinding initializes content rather than recording an edit. */
export class TransactionRouter<Key> {
	constructor(
		private file: Key | null,
		private accept: (key: Key, observation: Observation) => void,
		private enabled: (key: Key) => boolean = () => true,
	) {}

	update(file: Key | null, transactions: readonly Transaction[]): void {
		if (file !== this.file) { this.file = file; return; }
		if (file === null || !this.enabled(file)) return;
		for (const transaction of transactions) {
			const observation = transactionObservation(transaction);
			if (observation) this.accept(file, observation);
		}
	}
}
