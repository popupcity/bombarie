export interface Message {
  text: string;
  bold?: string;
  view?: string;
  photo?: Uint8Array;
}

export type Notify = (message: Message) => Promise<void>;

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;

export function telegram(token: string, chat: string, fetchImpl: typeof fetch = fetch): Notify {
  const call = async (method: string, init: RequestInit): Promise<void> => {
    let res: Response;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', ...init });
    } catch {
      throw new Error('Telegram request failed');
    }
    if (!res.ok) throw new Error(`Telegram ${method} failed (${res.status})`);
  };

  return async function send({ text, bold, view, photo }: Message): Promise<void> {
    const button = view?.startsWith('https://') ? view : undefined;
    const full = view && !button ? `${text}\n${view}` : text;
    const max = photo ? MAX_CAPTION : MAX_TEXT;
    const cut = full.length > max ? `${full.slice(0, max - 1)}…` : full;
    const body = photo ? cut.replace(/\r?\n/g, '\r\n') : cut;
    const at = bold ? body.indexOf(bold) : -1;
    const entities = bold && at >= 0 ? [{ type: 'bold', offset: at, length: bold.length }] : undefined;
    const markup = button ? { inline_keyboard: [[{ text: 'View', url: button }]] } : undefined;

    if (!photo) {
      return call('sendMessage', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: body, disable_web_page_preview: true, ...(entities && { entities }), ...(markup && { reply_markup: markup }) })
      });
    }
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('caption', body);
    if (entities) form.set('caption_entities', JSON.stringify(entities));
    if (markup) form.set('reply_markup', JSON.stringify(markup));
    form.set('photo', new Blob([photo as BlobPart], { type: 'image/jpeg' }), 'photo.jpg');
    return call('sendPhoto', { body: form }).catch(() => send({ text, ...(bold && { bold }), ...(view && { view }) }));
  };
}
