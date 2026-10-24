import { visit } from "unist-util-visit";

// ==文本== → <mark>文本</mark>，与管理台预览的高亮语法保持一致
const MARK_RE = /==([^=\n]+)==/g;

export function remarkMark() {
	return (tree) => {
		visit(tree, "text", (node, index, parent) => {
			if (!parent || index === undefined || index === null) return;
			const value = node.value;
			if (!value.includes("==")) return;
			const children = [];
			let last = 0;
			let m;
			MARK_RE.lastIndex = 0;
			while ((m = MARK_RE.exec(value)) !== null) {
				if (m.index > last)
					children.push({ type: "text", value: value.slice(last, m.index) });
				children.push({
					type: "mark",
					data: { hName: "mark" },
					children: [{ type: "text", value: m[1] }],
				});
				last = m.index + m[0].length;
			}
			if (children.length === 0) return;
			if (last < value.length)
				children.push({ type: "text", value: value.slice(last) });
			parent.children.splice(index, 1, ...children);
			return index + children.length;
		});
	};
}
