export interface Part {
  text: string;
  by?: string;
  images?: string[];
}

const SEPARATOR = /^[ \t]*---(?:[ \t]+([a-z0-9-]+-linkedin))?[ \t]*$/;
const MEDIA_LINE = /^[ \t]*!\[[^\]]*\]\((?:<([^<>]+)>|([^()<>\s]+))\)[ \t]*$/;

function takeMedia(lines: string[]): { text: string; images: string[] } {
  const images: string[] = [];
  const kept = lines.filter((line) => {
    const found = MEDIA_LINE.exec(line);
    if (found) images.push((found[1] ?? found[2])!);
    return !found;
  });
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), images };
}

export const mediaLines = (names: string[]): string => names.map((name) => `![](${/[\s()]/.test(name) ? `<${name}>` : name})`).join('\n');

export const withMediaLines = (text: string, images: string[] = []): string => [text.trim(), mediaLines(images)].filter(Boolean).join('\n\n');

export const splitMedia = (text: string): { text: string; images: string[] } => takeMedia(text.split('\n'));

export const renameMedia = (text: string, from: string, to: string): string =>
  text
    .split('\n')
    .map((line) => {
      const found = MEDIA_LINE.exec(line);
      return found && (found[1] ?? found[2]) === from ? mediaLines([to]) : line;
    })
    .join('\n');

export function splitFirst(body: string): { text: string; images: string[]; rest: string } {
  const lines = body.split('\n');
  const end = lines.findIndex((line) => SEPARATOR.test(line));
  return { ...takeMedia(end === -1 ? lines : lines.slice(0, end)), rest: end === -1 ? '' : lines.slice(end).join('\n') };
}

export const joinFirst = (text: string, images: string[], rest: string): string => [withMediaLines(text, images), rest.trim()].filter(Boolean).join('\n\n');

export function splitThread(body: string): Part[] {
  const parts: { lines: string[]; by?: string }[] = [{ lines: [] }];
  for (const line of body.split('\n')) {
    const found = SEPARATOR.exec(line);
    if (found) parts.push({ lines: [], ...(found[1] && { by: found[1] }) });
    else parts[parts.length - 1]!.lines.push(line);
  }
  return parts.map(({ lines, by }) => {
    const { text, images } = takeMedia(lines);
    return { text, ...(by && { by }), ...(images.length > 0 && { images }) };
  });
}

export const splitParts = (body: string): string[] => splitThread(body).map((part) => part.text);

export const joinThread = ([first, ...later]: Part[]): string =>
  [withMediaLines(first?.text ?? '', first?.images), ...later.map((part) => [`---${part.by ? ` ${part.by}` : ''}`, withMediaLines(part.text, part.images)].filter(Boolean).join('\n\n'))].join('\n\n');

export const allMedia = (images: string[], body: string): string[] => [...new Set([...images, ...splitThread(body).flatMap((part) => part.images ?? [])])];
