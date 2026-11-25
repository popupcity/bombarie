type Child = Node | string;
type Props = Record<string, string | number | boolean | undefined | ((event: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value !== undefined) node.setAttribute(key, String(value));
  }
  node.append(...children);
  return node;
}
