/** Small injected DOM tree: text nodes, elements and fragment transfer, without HTML parsing. */
export class TestNode {
	children: TestNode[] = [];
	className = '';
	writes = 0;
	private value = '';
	parentNode: TestNode | undefined;
	private attributes = new Map<string, string>();

	constructor(readonly ownerDocument: TestDocument, readonly nodeName: string) {}
	get nodeType(): number { return this.nodeName === '#text' ? 3 : this.nodeName === '#document-fragment' ? 11 : 1; }
	get tagName(): string { return this.nodeName; }
	get childNodes(): TestNode[] { return this.children; }
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	matches(selector: string): boolean {
		return selector.split(', ').some((part) => {
			if (part.startsWith('.')) return this.className.split(' ').includes(part.slice(1));
			if (part.startsWith('[')) {
				const [name, value] = part.slice(1, -1).split('=');
				return value ? this.attributes.get(name!) === value.replaceAll('"', '') : this.attributes.has(name!);
			}
			return this.nodeName === part.toUpperCase();
		});
	}

	get textContent(): string { return this.children.length ? this.children.map((node) => node.textContent).join('') : this.value; }
	set textContent(text: string | null) { this.writes++; this.children = []; this.value = text ?? ''; }
	appendChild(node: TestNode): TestNode {
		if (node.nodeName === '#document-fragment') { for (const child of node.children) this.appendChild(child); node.children = []; }
		else { this.children.push(node); node.parentNode = this; }
		return node;
	}
	replaceWith(node: TestNode): void {
		const parent = this.parentNode!;
		const index = parent.children.indexOf(this);
		const inserted = node.nodeName === '#document-fragment' ? node.children : [node];
		parent.children.splice(index, 1, ...inserted);
		for (const child of inserted) child.parentNode = parent;
		this.parentNode = undefined;
		if (node.nodeName === '#document-fragment') node.children = [];
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
