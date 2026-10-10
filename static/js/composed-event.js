export function composedTarget(event) {
  return event.composedPath?.()[0] ?? event.target ?? null;
}

export function composedContains(parent, node) {
  while (node) {
    if (parent === node || parent.contains(node)) return true;
    node = node.getRootNode?.().host ?? null;
  }
  return false;
}
