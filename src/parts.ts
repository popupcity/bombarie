export interface Part {
  text: string;
  by?: string;
}

const SEPARATOR = /^[ \t]*---(?:[ \t]+([a-z0-9-]+-linkedin))?[ \t]*$/;

export function splitThread(body: string): Part[] {
  const parts: { lines: string[]; by?: string }[] = [{ lines: [] }];
  for (const line of body.split('\n')) {
    const found = SEPARATOR.exec(line);
    if (found) parts.push({ lines: [], ...(found[1] && { by: found[1] }) });
    else parts[parts.length - 1]!.lines.push(line);
  }
  return parts.map(({ lines, by }) => ({ text: lines.join('\n').trim(), ...(by && { by }) }));
}

export const splitParts = (body: string): string[] => splitThread(body).map((part) => part.text);

export const joinThread = ([first, ...later]: Part[]): string => [first?.text ?? '', ...later.map((part) => `---${part.by ? ` ${part.by}` : ''}\n\n${part.text}`)].join('\n\n');
