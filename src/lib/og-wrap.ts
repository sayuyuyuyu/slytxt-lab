/** 文字の幅の目安。全角を 1、半角を 0.5 として、56px の描画で 17 を行幅（約 950px）に合わせる。 */
function charUnits(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  if (code <= 0x7e) return 0.5;
  if (code >= 0xff61 && code <= 0xff9f) return 0.5;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    code === 0x2026 ||
    code >= 0x1f000 ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
    return 1;
  return 0.5;
}

function textUnits(characters: string[]): number {
  return characters.reduce((sum, character) => sum + charUnits(character), 0);
}

export function wrapText(value: string, maxUnits = 17): string[] {
  const characters = Array.from(value);
  const lines: string[] = [];
  let start = 0;

  while (start < characters.length) {
    let units = 0;
    let end = start;
    while (
      end < characters.length &&
      units + charUnits(characters[end]) <= maxUnits
    ) {
      units += charUnits(characters[end]);
      end++;
    }
    if (end >= characters.length) {
      lines.push(characters.slice(start).join(""));
      break;
    }
    // 空白で切れる場合は単語の途中で割らない。行の前半にしか空白が無い場合は従来どおり幅で切る。
    let breakAt = -1;
    for (let index = end - 1; index > start; index--) {
      if (characters[index] === " " || characters[index] === "　") {
        if (textUnits(characters.slice(start, index)) >= maxUnits / 2)
          breakAt = index;
        break;
      }
    }
    if (breakAt > start) {
      lines.push(characters.slice(start, breakAt).join(""));
      start = breakAt + 1;
    } else {
      lines.push(characters.slice(start, end).join(""));
      start = end;
    }
  }

  if (lines.length > 3) {
    const third = Array.from(lines[2]);
    while (third.length > 0 && textUnits(third) + 1 > maxUnits) third.pop();
    lines[2] = third.join("") + "…";
  }
  return lines.slice(0, 3);
}
