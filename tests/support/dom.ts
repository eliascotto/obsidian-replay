import { after, before } from 'node:test';

/** Small injected DOM tree: text nodes, elements and fragment transfer, without HTML parsing. */
export class TestNode {
	children: TestNode[] = [];
	className = '';
	writes = 0;
	private value = '';
	parentNode: TestNode | undefined;
	private attributes = new Map<string, string>();

	constructor(public ownerDocument: TestDocument, readonly nodeName: string) {}
	get nodeType(): number { return this.nodeName === '#text' ? 3 : this.nodeName === '#document-fragment' ? 11 : 1; }
	get tagName(): string { return this.nodeName; }
	get childNodes(): TestNode[] { return this.children; }
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	appendText(text: string): void { this.appendChild(this.ownerDocument.createTextNode(text)); }
	createEl(name: string, options: { cls?: string; text?: string } = {}): TestNode {
		return this.appendElement(name, options);
	}
	createSpan(options: { cls?: string; text?: string } = {}): TestNode { return this.appendElement('span', options); }
	private appendElement(name: string, options: { cls?: string; text?: string }): TestNode {
		const node = this.ownerDocument.createElement(name);
		node.className = options.cls ?? '';
		if (options.text !== undefined) node.textContent = options.text;
		return this.appendChild(node);
	}
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
	adopted: TestNode[] = [];
	adoptNode(node: TestNode): TestNode {
		this.adopted.push(node);
		const adopt = (child: TestNode): void => { child.ownerDocument = this; child.children.forEach(adopt); };
		adopt(node);
		return node;
	}
	createElement(name: string): TestNode { const node = new TestNode(this, name.toUpperCase()); this.created.push(node); return node; }
	createTextNode(text: string): TestNode { const node = new TestNode(this, '#text'); node.textContent = text; this.created.push(node); return node; }
	createDocumentFragment(): TestNode { return new TestNode(this, '#document-fragment'); }
}

// Obsidian provides this global at runtime. Create it in another document so the
// rendering tests also exercise adoption into the target's document.
const originalCreateFragment = Object.getOwnPropertyDescriptor(global, 'createFragment');
before(() => {
	Object.defineProperty(global, 'createFragment', {
		configurable: true,
		value: () => new TestDocument().createDocumentFragment(),
	});
});
after(() => {
	if (originalCreateFragment) Object.defineProperty(global, 'createFragment', originalCreateFragment);
	else Reflect.deleteProperty(global, 'createFragment');
});
