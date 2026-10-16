// Turn a syntax-highlighting tree (hast, from lowlight) into React elements.
// Only <span> elements with a className and text nodes are kept; any other
// element is dropped but its text is kept, so a tree can never produce markup
// beyond coloured spans (and there's no innerHTML anywhere).
export function hastToReact(node, key = 'h') {
  if (!node) return null;
  if (node.type === 'text') return node.value;
  const children = (node.children || []).map((child, i) => hastToReact(child, `${key}.${i}`));
  if (node.type === 'element' && node.tagName === 'span') {
    const cls = node.properties && node.properties.className;
    const className = Array.isArray(cls) ? cls.filter((c) => typeof c === 'string').join(' ') : undefined;
    return (
      <span key={key} className={className}>
        {children}
      </span>
    );
  }
  // root, or an element we don't allow: keep just the content.
  return children;
}
