/** Small injected DOM tree: text nodes, elements and fragment transfer, without HTML parsing. */
export class TestNode {
	children: TestNode[] = [];
	className = '';
	writes = 0;
	private value = '';

	constructor(readonly ownerDocument: TestDocument, readonly nodeName: string) {}

	get textContent(): string { return this.children.length ? this.children.map((node) => node.textContent).join('') : this.value; }
	set textContent(text: string | null) { this.writes++; this.children = []; this.value = text ?? ''; }
	appendChild(node: TestNode): TestNode {
		if (node.nodeName === '#document-fragment') { this.children.push(...node.children); node.children = []; }
		else this.children.push(node);
		return node;
	}
	replaceChildren(...nodes: TestNode[]): void {
		this.writes++;
		this.value = '';
		this.children = [];
		for (const node of nodes) this.appendChild(node);
	}
	get element(): HTMLElement { return this as unknown as HTMLElement; }
}

export class TestDocument {
	created: TestNode[] = [];
	createElement(name: string): TestNode { const node = new TestNode(this, name.toUpperCase()); this.created.push(node); return node; }
	createTextNode(text: string): TestNode { const node = new TestNode(this, '#text'); node.textContent = text; this.created.push(node); return node; }
	createDocumentFragment(): TestNode { return new TestNode(this, '#document-fragment'); }
}
