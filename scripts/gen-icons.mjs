// PWA 아이콘 생성 (512/192) — 따뜻한 크림 배경 + 크레센트 문
import { PNG } from "pngjs";
import fs from "fs";

function makeIcon(size) {
  const png = new PNG({ width: size, height: size });
  const bg = [194, 112, 61];      // accent #c2703d
  const fg = [250, 247, 242];     // paper #faf7f2
  const r = size * 0.22;          // 라운드 반경
  const cx = size / 2, cy = size / 2;
  const moonR = size * 0.30;
  const cutX = cx + size * 0.11, cutY = cy - size * 0.07, cutR = size * 0.26;
  const dotX = cx - size * 0.13, dotY = cy + size * 0.16, dotR = size * 0.035;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      // 라운드 사각형 클리핑
      const dx = Math.max(Math.abs(x - cx) - (size / 2 - r), 0);
      const dy = Math.max(Math.abs(y - cy) - (size / 2 - r), 0);
      const inside = dx * dx + dy * dy <= r * r;
      if (!inside) { png.data[idx + 3] = 0; continue; }
      let c = bg;
      const dMoon = (x - cx) ** 2 + (y - cy) ** 2;
      const dCut = (x - cutX) ** 2 + (y - cutY) ** 2;
      const dDot = (x - dotX) ** 2 + (y - dotY) ** 2;
      if ((dMoon <= moonR * moonR && dCut > cutR * cutR) || dDot <= dotR * dotR) c = fg;
      png.data[idx] = c[0]; png.data[idx + 1] = c[1]; png.data[idx + 2] = c[2]; png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

fs.writeFileSync("public/icon-512.png", makeIcon(512));
fs.writeFileSync("public/icon-192.png", makeIcon(192));
console.log("icons generated");
