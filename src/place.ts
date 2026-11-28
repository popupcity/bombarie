const EDGE = 8;
const OFFSET = 4;

export interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface View extends Size {
  left: number;
  top: number;
}

export interface Wish {
  align: 'start' | 'end';
  side: 'below' | 'above';
}

const within = (value: number, from: number, to: number): number => Math.max(Math.min(value, to), from);

export function spotFor(anchor: Anchor, box: Size, view: View, wish: Wish): { left: number; top: number } {
  const room = { below: view.top + view.height - anchor.bottom - OFFSET - EDGE, above: anchor.top - view.top - OFFSET - EDGE };
  const other = wish.side === 'below' ? 'above' : 'below';
  const side = box.height <= room[wish.side] ? wish.side : box.height <= room[other] ? other : room.below >= room.above ? 'below' : 'above';
  const left = wish.align === 'end' ? anchor.right - box.width : anchor.left;
  const top = side === 'below' ? anchor.bottom + OFFSET : anchor.top - OFFSET - box.height;
  return {
    left: within(left, view.left + EDGE, view.left + view.width - box.width - EDGE),
    top: within(top, view.top + EDGE, view.top + view.height - box.height - EDGE)
  };
}

export const roomOf = (view: View): number => view.height - 2 * EDGE;
