/**
 * Tiny corner-overlay HUD — plain DOM, no framework. Each example calls
 * `updateHud` once per frame with whatever stats it wants shown.
 */
export interface HudRow {
  label: string;
  value: string | number;
}

export function createHud(title: string): { root: HTMLDivElement; update: (rows: HudRow[]) => void } {
  const root = document.createElement('div');
  root.className = 'hud';
  const heading = document.createElement('h1');
  heading.textContent = title;
  root.appendChild(heading);
  document.getElementById('app')?.appendChild(root);

  const rowEls: HTMLDivElement[] = [];

  function update(rows: HudRow[]): void {
    while (rowEls.length < rows.length) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      const value = document.createElement('b');
      row.appendChild(label);
      row.appendChild(value);
      root.appendChild(row);
      rowEls.push(row);
    }
    rows.forEach((r, i) => {
      const row = rowEls[i];
      (row.children[0] as HTMLSpanElement).textContent = r.label;
      (row.children[1] as HTMLElement).textContent = String(r.value);
    });
  }

  return { root, update };
}

export function addHint(text: string): void {
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = text;
  document.getElementById('app')?.appendChild(hint);
}

export function addSourceLink(path: string): void {
  const link = document.createElement('a');
  link.className = 'source-link';
  link.href = `https://github.com/swapp1990/three-box3d/blob/main/examples/vanilla-three/${path}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'View source ↗';
  document.getElementById('app')?.appendChild(link);
}

export function addBackLink(): void {
  const link = document.createElement('a');
  link.className = 'back-link';
  link.href = '/';
  link.textContent = '← All examples';
  document.getElementById('app')?.appendChild(link);
}
