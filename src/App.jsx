import React, { useState, useRef, useMemo, useEffect } from "react";
import { jsPDF } from "jspdf";

/* ============================================================
   MULTIPL — "Give your money a side hustle"
   Appointment Letter generator, v3.

   Palette sampled directly from multipl-spending-account-v2
   screenshots — these are measured, not inferred.

   sun    #F8D75D  hero yellow
   bark   #311709  dark brown — ink, nav pills, borders
   nib    #16110E  near-black brown, body copy
   rust   #AE4026  the italic clause colour
   leaf   #51A95C  green sections / positive state
   moss   #418A4D  green eyebrow labels
   cream  #FEF8DF  cards and paper
   blush  #F8D6D6  alert block
   alarm  #C6322C  alert text

   Signature devices lifted from the site:
   · roman clause + rust italic clause headline
   · hard offset shadow, no blur, on every card and pill
   · green dot + letterspaced uppercase eyebrow
   · struck original → highlighted effective value
   ============================================================ */

const T = {
  sun: "#FFD53D",
  bark: "#311709",
  nib: "#16110E",
  rust: "#AE4026",
  leaf: "#51A95C",
  moss: "#418A4D",
  cream: "#FEF8DF",
  blush: "#F8D6D6",
  alarm: "#C6322C",
  fade: "#8A7A62",
  rule: "#D9CBA6",
};

/* Webfonts are used for the app chrome. The letter deliberately uses
   Georgia + system stacks: an SVG serialised to a blob for PNG export
   cannot resolve external @font-face, so anything else would make the
   download differ from what's on screen. For production, embed the real
   brand faces as base64 inside the SVG. */
const DISPLAY_UI = "'Gilroy', Arial, sans-serif";
const SANS_UI = "'Gilroy', Arial, sans-serif";
const DISPLAY = "Georgia, 'Times New Roman', serif";
const SANS =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO =
  "'DejaVu Sans Mono', 'Noto Sans Mono', 'Courier New', ui-monospace, monospace";

const CONFIG = {
  qrUrl: import.meta.env.VITE_QR_URL || "https://multipl.in/hire",
  appUrl: import.meta.env.VITE_APP_URL || "https://multipl.in",
  handle: "@multipl",
  hashtag: "#GiveYourMoneyASideHustle",
  joiningBonus: 1000,
  brandCount: "100+",
  startingEmployeeNo: 48217,
};

/* ============================================================
   QR ENCODER — byte mode, EC M, versions 1-6.
   Verified end-to-end: encoded → rendered → decoded by a scanner.
   ============================================================ */
const EXP = new Array(512);
const LOG = new Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i; x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
function rsGenPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gmul(poly[j], 1);
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const f = data[i] ^ res[0];
    res.shift(); res.push(0);
    for (let j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], f);
  }
  return res;
}
const SPEC = { 1:[26,10,1,16], 2:[44,16,1,28], 3:[70,26,1,44], 4:[100,18,2,32], 5:[134,24,2,43], 6:[172,16,4,27] };
const ALIGN = { 1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30], 6:[6,34] };
function utf8Bytes(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}
function buildCodewords(bytes, version) {
  const [, ecLen, blocks, dataPer] = SPEC[version];
  const dataCw = blocks * dataPer;
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(4, 4); push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const cap = dataCw * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  const pad = [0xec, 0x11];
  let p = 0;
  while (cw.length < dataCw) cw.push(pad[p++ % 2]);
  const dB = [], eB = [];
  for (let i = 0; i < blocks; i++) {
    const blk = cw.slice(i * dataPer, (i + 1) * dataPer);
    dB.push(blk); eB.push(rsEncode(blk, ecLen));
  }
  const out = [];
  for (let i = 0; i < dataPer; i++) for (const b of dB) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of eB) out.push(b[i]);
  return out;
}
function skeleton(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const res = Array.from({ length: size }, () => new Array(size).fill(false));
  const finder = (r, c) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r + i, cc = c + j;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
        (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
        (i >= 2 && i <= 4 && j >= 2 && j <= 4);
      m[rr][cc] = on ? 1 : 0; res[rr][cc] = true;
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    m[6][i] = bit; res[6][i] = true;
    m[i][6] = bit; res[i][6] = true;
  }
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0;
      res[r + i][c + j] = true;
    }
  }
  m[size - 8][8] = 1; res[size - 8][8] = true;
  for (let i = 0; i < 9; i++) {
    if (!res[8][i]) { res[8][i] = true; m[8][i] = 0; }
    if (!res[i][8]) { res[i][8] = true; m[i][8] = 0; }
  }
  for (let i = 0; i < 8; i++) {
    if (!res[8][size - 1 - i]) { res[8][size - 1 - i] = true; m[8][size - 1 - i] = 0; }
    if (!res[size - 1 - i][8]) { res[size - 1 - i][8] = true; m[size - 1 - i][8] = 0; }
  }
  return { m, res, size };
}
function placeData(m, res, size, cws) {
  let idx = 0;
  const total = cws.length * 8;
  const bit = () => {
    if (idx >= total) return 0;
    const b = (cws[idx >> 3] >> (7 - (idx & 7))) & 1; idx++; return b;
  };
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = up ? size - 1 - k : k;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (!res[row][cc]) m[row][cc] = bit();
      }
    }
    up = !up;
  }
}
function maskFn(i, r, c) {
  switch (i) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}
function applyFormat(m, size, mask) {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) m[i][8] = (bits >> i) & 1;
  m[7][8] = (bits >> 6) & 1;
  m[8][8] = (bits >> 7) & 1;
  m[8][7] = (bits >> 8) & 1;
  for (let i = 9; i < 15; i++) m[8][14 - i] = (bits >> i) & 1;
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = (bits >> i) & 1;
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = (bits >> i) & 1;
  m[size - 8][8] = 1;
}
function penalty(m, size) {
  let s = 0;
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < size; a++) {
    let run = 1;
    for (let b = 1; b < size; b++) {
      const cur = pass === 0 ? m[a][b] : m[b][a];
      const prev = pass === 0 ? m[a][b - 1] : m[b - 1][a];
      if (cur === prev) run++;
      else { if (run >= 5) s += run - 2; run = 1; }
    }
    if (run >= 5) s += run - 2;
  }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) s += 3;
  }
  const pat = [1,0,1,1,1,0,1,0,0,0,0];
  const rev = pat.slice().reverse();
  const match = (arr, p, off) => { for (let i = 0; i < 11; i++) if (arr[off + i] !== p[i]) return false; return true; };
  for (let a = 0; a < size; a++) {
    const row = m[a], col = m.map((r) => r[a]);
    for (let b = 0; b + 11 <= size; b++) {
      if (match(row, pat, b) || match(row, rev, b)) s += 40;
      if (match(col, pat, b) || match(col, rev, b)) s += 40;
    }
  }
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  s += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return s;
}
function makeQR(text) {
  const bytes = utf8Bytes(text);
  let version = 6;
  for (let v = 1; v <= 6; v++) {
    const [, , blocks, dataPer] = SPEC[v];
    if (Math.floor((blocks * dataPer * 8 - 12) / 8) >= bytes.length) { version = v; break; }
  }
  const cws = buildCodewords(bytes, version);
  const { m, res, size } = skeleton(version);
  placeData(m, res, size, cws);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const cand = m.map((r) => r.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!res[r][c] && maskFn(mask, r, c)) cand[r][c] ^= 1;
    applyFormat(cand, size, mask);
    const sc = penalty(cand, size);
    if (sc < bestScore) { bestScore = sc; best = cand; }
  }
  return best;
}

/* ============================================================
   CONTENT — the site's own spend vocabulary
   ============================================================ */
const JOBS = [
  { id: "food", label: "Food order money", tag: "the midnight biryani" },
  { id: "card", label: "Card bill money", tag: "the big one" },
  { id: "rent", label: "Rent money", tag: "idle 25 days a month" },
  { id: "rides", label: "Ride money", tag: "cabs, autos, metro" },
  { id: "grocery", label: "Grocery money", tag: "the 10-minute habit" },
  { id: "shopping", label: "Shopping money", tag: "cart, wishlist, repeat" },
  { id: "fuel", label: "Fuel money", tag: "petrol and charging" },
  { id: "subs", label: "Subscription money", tag: "the ones you forgot" },
  { id: "travel", label: "Travel money", tag: "flights and stays" },
  { id: "movies", label: "Weekend movie money", tag: "Friday to Sunday" },
  { id: "emi", label: "EMI money", tag: "due on the 5th" },
  { id: "gift", label: "Festival money", tag: "Diwali, weddings" },
];
const BANDS = [
  { label: "Under ₹2,000", value: 1500 },
  { label: "₹2,000 – ₹5,000", value: 3500 },
  { label: "₹5,000 – ₹10,000", value: 7500 },
  { label: "₹10,000 – ₹25,000", value: 17500 },
  { label: "Over ₹25,000", value: 32000 },
];
const DECADES = [
  { id: "2000s", label: "In the 2000s", year: "2006" },
  { id: "2010s", label: "In the 2010s", year: "2014" },
  { id: "2020s", label: "In the 2020s", year: "2021" },
];

function designation(picked, total) {
  const top = Object.keys(picked).sort((a, b) => BANDS[picked[b]].value - BANDS[picked[a]].value)[0];
  const n = Object.keys(picked).length;
  if (total >= 100000) return "The Household Institution";
  if (n >= 7) return "The Diversified Idler";
  if (top === "food") return "The Midnight Biryani Portfolio";
  if (top === "card") return "The Card Bill Warrior";
  if (top === "rent") return "The Rent Day Refugee";
  if (top === "rides") return "The Surge Pricing Survivor";
  if (top === "grocery") return "The Ten-Minute Economist";
  if (top === "shopping") return "The Cart Abandonment Specialist";
  if (top === "fuel") return "The Petrol Pump Philosopher";
  if (top === "subs") return "The Free Trial Escapee";
  if (top === "travel") return "The Departure Gate Optimist";
  if (top === "movies") return "The Friday Night Financier";
  if (top === "emi") return "The Fifth of the Month Lifer";
  if (top === "gift") return "The Festival Season Treasurer";
  if (total < 5000) return "The Quiet Compounder";
  return "The Idle Balance Incumbent";
}

const inr = (n) => "₹" + n.toLocaleString("en-IN");

function fitLabels(labels, maxChars, maxLines) {
  const lines = [];
  let cur = "", used = 0;
  for (let i = 0; i < labels.length; i++) {
    const piece = cur ? `${cur}, ${labels[i]}` : labels[i];
    const budget = lines.length + 1 === maxLines ? maxChars - 10 : maxChars;
    if (piece.length <= budget) { cur = piece; used = i + 1; }
    else if (lines.length + 1 < maxLines) { lines.push(cur + ","); cur = labels[i]; used = i + 1; }
    else break;
  }
  lines.push(cur);
  const left = labels.length - used;
  if (left > 0) lines[lines.length - 1] += ` +${left} more`;
  return lines;
}

/* The sunburst mark, redrawn from the wordmark */
function Sunburst({ x, y, r = 26 }) {
  const spokes = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    spokes.push(
      <line key={i} x1={0} y1={0} x2={Math.cos(a) * (r - 7)} y2={Math.sin(a) * (r - 7)}
        stroke={T.bark} strokeWidth="1.9" strokeLinecap="round" />
    );
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={T.bark} />
      <circle r={r - 7} fill={T.sun} />
      {spokes}
      <circle r="2.2" fill={T.bark} />
    </g>
  );
}

/* ============================================================
   THE LETTER — 4:5, exports pixel-perfect
   ============================================================ */
const W = 1080, PAGE_H = 1350;
const L = 92, RCOL = 400, RIGHT = W - 92, BAND = 196;

function getDateParts(date = new Date()) {
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();

  const mod100 = day % 100;
  let suffix = "th";

  if (mod100 < 11 || mod100 > 13) {
    if (day % 10 === 1) suffix = "st";
    else if (day % 10 === 2) suffix = "nd";
    else if (day % 10 === 3) suffix = "rd";
  }

  return { day, suffix, month, year };
}

function Letter({ data, svgRef, sealed }) {
  const { total, jobs, role, name, since } = data;
  const letterDate = getDateParts();
  const modules = useMemo(() => makeQR(`${CONFIG.qrUrl}?e=${data.empNo}`), [data.empNo]);
  const qn = modules.length, qrPx = 148, cell = qrPx / qn;
  const qrX = 92, qrY = 1060;

  const dutyLines = fitLabels(jobs, 42, 2);
  const roleSize = role.length > 25 ? 39 : 45;
  const strikeW = `Unemployed since ${since}`.length * 13.0;

  const terms = [
    `Joining bonus of ${inr(CONFIG.joiningBonus)} in spending credit.`,
    "Salary parked in liquid mutual funds, in your name.",
    "Instant redemption. Reports for duty in seconds.*",
    "Pays by UPI at any QR code in India.",
    `Staff discounts at ${CONFIG.brandCount} partner brands.`,
    "May resign anytime. Bank Withdrawal, no notice period.",
  ];

  const Rule = ({ ty, o = 1 }) => (
    <line x1={92} y1={ty} x2={988} y2={ty} stroke={T.rule} strokeWidth="1.4" opacity={o} />
  );

  const Label = ({ ty, children, fill = T.fade }) => (
    <text x={92} y={ty} fontFamily={SANS} fontSize="14" fontWeight="700"
      letterSpacing="2.6" fill={fill}>{children}</text>
  );

  let y = 442;
  const rows = [];
  rows.push({ label: "EMPLOYEE", value: `${inr(total)} per month`, y, big: true }); y += 52;
  rows.push({ label: "DUTIES", value: dutyLines, y }); y += 78;
  rows.push({ label: "PREV. EMPLOYER", value: "Savings Account", y }); y += 52;
  const statusY = y; y += 82;
  rows.push({ label: "DAYS WORKED", value: "0", y }); y += 52;
  rows.push({ label: "REPORTS TO", value: `${name || "You"}, Chief Money Officer`, y }); y += 52;
  const termsTop = y;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${PAGE_H}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {/* The uploaded Page 1 artwork supplies the header, cream paper and footer. */}
      <image
        href={`${import.meta.env.BASE_URL}appointment-letter-page-1.png`}
        x="0"
        y="0"
        width={W}
        height={PAGE_H}
        preserveAspectRatio="none"
      />

      {/* Dynamic header date. Keep the date removed from the PNG template. */}
      <text
        x={988}
        y={122}
        textAnchor="end"
        fontFamily={SANS}
        fontSize="18"
        fontWeight="600"
        letterSpacing="1.1"
        fill="#FEF8DF"
      >
        <tspan>{letterDate.day}</tspan>
        <tspan
          fontSize="11"
          baselineShift="super"
          letterSpacing="0.4"
        >
          {letterDate.suffix}
        </tspan>
        <tspan dx="5">{` ${letterDate.month} ${letterDate.year}`}</tspan>
      </text>

      {/* Dynamic content starts only inside the blank cream body. */}
      <Label ty={264} fill={T.moss}>DESIGNATION</Label>
      <text x={92} y={330} fontFamily={DISPLAY} fontStyle="italic" fontSize={roleSize} fill={T.rust}>
        {role}
      </text>
      <Rule ty={378} />

      {rows.map((r, i) => (
        <g key={i}>
          <Label ty={r.y}>{r.label}</Label>
          {Array.isArray(r.value)
            ? r.value.map((ln, j) => (
                <text key={j} x={400} y={r.y + j * 31} fontFamily={MONO} fontSize="21" fill={T.nib}>
                  {ln}
                </text>
              ))
            : (
              <text
                x={400}
                y={r.y}
                fontFamily={MONO}
                fontSize={r.big ? 27 : 21}
                fontWeight={r.big ? 700 : 400}
                fill={T.nib}
              >
                {r.value}
              </text>
            )}
        </g>
      ))}

      <Label ty={statusY}>STATUS</Label>
      <text x={400} y={statusY} fontFamily={MONO} fontSize="21" fill={T.fade}>
        {`Unemployed since ${since}`}
      </text>
      <line
        x1={400}
        y1={statusY - 7}
        x2={400 + strikeW}
        y2={statusY - 7}
        stroke={T.alarm}
        strokeWidth="2"
      />
      <rect
        x={388}
        y={statusY + 12}
        width="282"
        height="42"
        rx="21"
        fill={T.leaf}
        fillOpacity="0.18"
        stroke={T.leaf}
        strokeWidth="1.5"
      />
      <text x={400} y={statusY + 40} fontFamily={MONO} fontSize="21" fontWeight="700" fill={T.moss}>
        Employed from today
      </text>

      <Rule ty={termsTop - 26} />
      <Label ty={termsTop + 16}>TERMS OF EMPLOYMENT</Label>

      {terms.map((t, i) => (
        <g key={i}>
          <text x={92} y={termsTop + 54 + i * 29} fontFamily={SANS} fontSize="16.5" fontWeight="700" fill={T.moss}>
            {String(i + 1).padStart(2, "0")}
          </text>
          <text x={136} y={termsTop + 54 + i * 29} fontFamily={MONO} fontSize="17.2" fill={T.nib}>
            {t}
          </text>
        </g>
      ))}

      {/* QR + countersign area */}
      {modules.map((rowArr, r) =>
        rowArr.map((v, c) =>
          v ? (
            <rect
              key={`${r}-${c}`}
              x={qrX + c * cell}
              y={qrY + r * cell}
              width={cell + 0.5}
              height={cell + 0.5}
              fill={T.bark}
            />
          ) : null
        )
      )}

      <text x={qrX + qrPx + 38} y={qrY + 46} fontFamily={DISPLAY} fontStyle="italic"
        fontSize="31" fill={T.rust}>
        Countersign here ↗
      </text>
      <text x={qrX + qrPx + 38} y={qrY + 82} fontFamily={MONO} fontSize="16.5" fill={T.fade}>
        Scan to open a Multipl
      </text>
      <text x={qrX + qrPx + 38} y={qrY + 105} fontFamily={MONO} fontSize="16.5" fill={T.fade}>
        spending account.
      </text>
      <text x={qrX + qrPx + 38} y={qrY + 141} fontFamily={SANS} fontSize="15.5" fontWeight="700"
        letterSpacing="0.35" fill={T.moss}>
        {CONFIG.hashtag}
      </text>

      {/* seal */}
      <g transform={`translate(892 ${qrY + 78}) rotate(-9)`} opacity={sealed ? 1 : 0} className="seal">
        <circle r="64" fill={T.rust} fillOpacity="0.08" stroke={T.rust} strokeWidth="3.2" />
        <circle r="55" fill="none" stroke={T.rust} strokeWidth="1.2" opacity="0.6" />
        <text x="0" y="-6" textAnchor="middle" fontFamily={SANS} fontSize="23" fontWeight="800"
          letterSpacing="1.5" fill={T.rust}>
          HIRED
        </text>
        <line x1="-34" y1="8" x2="34" y2="8" stroke={T.rust} strokeWidth="1.2" opacity="0.6" />
        <text x="0" y="29" textAnchor="middle" fontFamily={MONO} fontSize="11.5"
          letterSpacing="0.9" fill={T.rust} opacity="0.9">
          MULTIPL HR
        </text>
      </g>
    </svg>
  );
}

/* ============================================================
   PAGE 2 — STATIC ONBOARDING BONUS
   This is intentionally NOT shown in the website flow.
   It is ready to be used as page 2 when we switch download to PDF.
   ============================================================ */
function PageTwo({ svgRef }) {
  const letterDate = getDateParts();

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${PAGE_H}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {/* Page 2 is completely static artwork. Only the generated date is added in code. */}
      <image
        href={`${import.meta.env.BASE_URL}appointment-letter-page-2.png`}
        x="0"
        y="0"
        width={W}
        height={PAGE_H}
        preserveAspectRatio="none"
      />

      <text
        x={988}
        y={122}
        textAnchor="end"
        fontFamily={SANS}
        fontSize="18"
        fontWeight="600"
        letterSpacing="1.1"
        fill="#FEF8DF"
      >
        <tspan>{letterDate.day}</tspan>
        <tspan
          fontSize="11"
          baselineShift="super"
          letterSpacing="0.4"
        >
          {letterDate.suffix}
        </tspan>
        <tspan dx="5">{` ${letterDate.month} ${letterDate.year}`}</tspan>
      </text>
    </svg>
  );
}

/* ============================================================
   APP CHROME
   ============================================================ */
export default function App() {
  const [screen, setScreen] = useState(0);
  const [picked, setPicked] = useState({});
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [decade, setDecade] = useState(null);
  const [empNo, setEmpNo] = useState(CONFIG.startingEmployeeNo);
  const [sealed, setSealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [screenDirection, setScreenDirection] = useState("forward");
  const [showConfetti, setShowConfetti] = useState(false);
  const svgRef = useRef(null);
  const pageTwoRef = useRef(null);

  const chosen = Object.keys(picked);
  const total = chosen.reduce((s, k) => s + BANDS[picked[k]].value, 0);

  const letterData = useMemo(() => ({
    total,
    jobs: chosen.map((k) => JOBS.find((j) => j.id === k).label),
    role: designation(picked, total),
    name, city,
    since: (DECADES.find((d) => d.id === decade) || DECADES[1]).year,
    empNo,
  }), [picked, total, name, city, decade, empNo]);

  const navigateTo = (nextScreen) => {
    setScreenDirection(nextScreen >= screen ? "forward" : "backward");
    setScreen(nextScreen);
  };

  const toggle = (id) => setPicked((p) => {
    const n = { ...p };
    if (n[id] !== undefined) delete n[id]; else n[id] = 2;
    return n;
  });

  const issue = () => {
    setEmpNo(CONFIG.startingEmployeeNo + Math.abs(
      [...(name + city + chosen.join())].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)
    ) % 1400);

    setScreenDirection("forward");
    setScreen(4);
    setSealed(false);

    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 2800);
    setTimeout(() => setSealed(true), 2650);
  };

  const download = async () => {
    const pageOneSvg = svgRef.current;
    const pageTwoSvg = pageTwoRef.current;

    if (!pageOneSvg || !pageTwoSvg) return;

    const fileToDataUrl = async (path) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Could not load ${path}`);

      const blob = await res.blob();

      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    const svgToPngDataUrl = async (sourceSvg, templatePath) => {
      const templateDataUrl = await fileToDataUrl(templatePath);

      const clonedSvg = sourceSvg.cloneNode(true);

      // Inline the PNG template so it survives SVG -> canvas rendering.
      const templateImage = clonedSvg.querySelector("image");
      if (templateImage) {
        templateImage.setAttribute("href", templateDataUrl);
        templateImage.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          "xlink:href",
          templateDataUrl
        );
      }

      const serialized = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob(
        [serialized],
        { type: "image/svg+xml;charset=utf-8" }
      );
      const svgUrl = URL.createObjectURL(svgBlob);

      try {
        const renderedImage = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = svgUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width = W * 2;
        canvas.height = PAGE_H * 2;

        const ctx = canvas.getContext("2d");
        ctx.fillStyle = T.cream;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(renderedImage, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL("image/png", 1);
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    };

    try {
      // PAGE 1 = dynamically generated appointment letter.
      const pageOnePng = await svgToPngDataUrl(
        pageOneSvg,
        `${import.meta.env.BASE_URL}appointment-letter-page-1.png`
      );

      // PAGE 2 = fixed onboarding-bonus layout + fixed copy.
      // It exists off-screen only and is never shown in the web flow.
      const pageTwoPng = await svgToPngDataUrl(
        pageTwoSvg,
        `${import.meta.env.BASE_URL}appointment-letter-page-2.png`
      );

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [W, PAGE_H],
        hotfixes: ["px_scaling"],
        compress: true,
      });

      pdf.addImage(
        pageOnePng,
        "PNG",
        0,
        0,
        W,
        PAGE_H,
        undefined,
        "FAST"
      );

      pdf.addPage([W, PAGE_H], "portrait");

      pdf.addImage(
        pageTwoPng,
        "PNG",
        0,
        0,
        W,
        PAGE_H,
        undefined,
        "FAST"
      );

      pdf.save(`multipl-appointment-letter-${empNo}.pdf`);
    } catch (error) {
      console.error("PDF download failed:", error);
      alert("Could not create the PDF. Please try again.");
    }
  };

  const caption = `My money just got hired. ${letterData.role}. ${inr(total)} a month, unemployed since ${letterData.since}. ${CONFIG.handle} ${CONFIG.hashtag}`;
  const copyCaption = () => {
    const ta = document.createElement("textarea");
    ta.value = caption;
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.sun, fontFamily: SANS_UI, color: T.bark }}>
      {showConfetti && <ConfettiBurst />}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-100000px",
          top: 0,
          width: W,
          height: PAGE_H,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <PageTwo svgRef={pageTwoRef} />
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');

        @font-face {
          font-family: 'Gilroy';
          src: local('Gilroy Regular'), local('Gilroy-Regular'), local('Gilroy');
          font-weight: 400;
          font-style: normal;
        }
        @font-face {
          font-family: 'Gilroy';
          src: local('Gilroy Medium'), local('Gilroy-Medium'), local('Gilroy');
          font-weight: 500;
          font-style: normal;
        }
        @font-face {
          font-family: 'Gilroy';
          src: local('Gilroy SemiBold'), local('Gilroy-SemiBold'), local('Gilroy');
          font-weight: 600;
          font-style: normal;
        }
        @font-face {
          font-family: 'Gilroy';
          src: local('Gilroy Bold'), local('Gilroy-Bold'), local('Gilroy');
          font-weight: 700;
          font-style: normal;
        }
        @font-face {
          font-family: 'Gilroy';
          src: local('Gilroy ExtraBold'), local('Gilroy-ExtraBold'), local('Gilroy Black'), local('Gilroy-Black'), local('Gilroy');
          font-weight: 800 900;
          font-style: normal;
        }

        .ui-highlight {
          font-family: 'DM Serif Display', Georgia, serif !important;
          font-style: italic;
          font-weight: 400 !important;
          letter-spacing: -3px !important;
        }
        * { box-sizing: border-box; }
        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          min-height: 100%;
          background: ${T.sun};
        }
        body {
          overflow-x: hidden;
        }
        .seal { animation: press .5s cubic-bezier(.2,1.3,.4,1) both; transform-box: fill-box; transform-origin: center; }
        @keyframes press { 0%{opacity:0; transform:scale(2.4) rotate(5deg)} 70%{opacity:.95; transform:scale(.95) rotate(-11deg)} 100%{opacity:1; transform:scale(1) rotate(-9deg)} }
        .card { animation: lift .55s cubic-bezier(.2,.9,.3,1) both; }
        @keyframes lift { from{opacity:0; transform:translateY(24px)} to{opacity:1; transform:none} }
        .rise { animation: rise .4s ease both; }
        @keyframes rise { from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:none} }
        .hard { transition: transform .12s ease, box-shadow .12s ease; }
        .hard:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 ${T.bark}; }
        .hard:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 ${T.bark}; }
                input[type=range]{
          -webkit-appearance:none;
          appearance:none;
          width:100%;
          height:5px;
          border-radius:99px;
          background:${T.leaf};
          border:none;
          outline:none;
        }

        input[type=range]::-webkit-slider-thumb{
          -webkit-appearance:none;
          appearance:none;
          width:24px;
          height:24px;
          border-radius:50%;
          background:${T.bark};
          border:2.5px solid ${T.bark};
          cursor:pointer;
        }

        input[type=range]::-moz-range-thumb{
          width:24px;
          height:24px;
          border-radius:50%;
          background:${T.bark};
          border:2.5px solid ${T.bark};
          cursor:pointer;
        }; border:2.5px solid ${T.bark}; cursor:pointer; }
        input[type=range]::-moz-range-thumb{ width:24px; height:24px; border-radius:50%; background:${T.leaf}; border:2.5px solid ${T.bark}; cursor:pointer; }
        button:focus-visible, input:focus-visible { outline:3px solid ${T.rust}; outline-offset:3px; }
        .home-hero-grid {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;

          display: grid;
          grid-template-columns: minmax(500px, .86fr) minmax(620px, 1.14fr);
          gap: clamp(58px, 5vw, 84px);
          align-items: start;

          padding: 4px 0 18px;
        }

        .home-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding-left: 2px;
        }

        /* Keep the eyebrow visually attached to the title block. */
        .home-eyebrow-wrap {
          display: inline-flex;
          align-self: flex-start;
          margin: 0 0 22px;
        }

        .home-eyebrow-wrap > div {
          margin-bottom: 0 !important;
        }

        .home-copy-main {
          width: 100%;
          max-width: 610px;
        }

        .home-copy-main h1 {
          margin: 0 0 22px !important;
        }

        .home-copy-main p {
          margin: 0;
        }

        .home-cta-row,
        .home-proof-row,
        .home-disclaimer {
          width: 100%;
          max-width: 610px;
        }

        .home-cta-row {
          display: flex;
          align-items: center;
          margin-top: 26px;
        }

        .home-cta-row button {
          min-height: 58px;
          padding-left: 29px !important;
          padding-right: 29px !important;
          font-size: 16.5px !important;
        }

        .home-proof-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 20px;
        }

        .proof-card {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 11px;

          background: rgba(254,248,223,.94);
          border: 1.6px solid ${T.bark};
          border-radius: 14px;

          padding: 13px 14px;
          box-shadow: 3px 3px 0 ${T.bark};
        }

        .proof-icon {
          width: 39px;
          height: 39px;
          border-radius: 50%;
          background: rgba(255,213,61,.76);

          display: grid;
          place-items: center;
          flex: 0 0 39px;
        }

        .proof-icon svg {
          width: 19px;
          height: 19px;
          stroke: ${T.bark};
          stroke-width: 2;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .proof-copy strong {
          display: block;
          font-size: 18px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: -.25px;
        }

        .proof-copy span {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          color: ${T.fade};
          line-height: 1.05;
          white-space: nowrap;
        }

        .home-disclaimer {
          display: block;

          margin-top: 16px;

          color: ${T.bark};
          font-size: 9.6px;
          line-height: 1.38;
          opacity: .82;
        }

        .home-disclaimer-copy {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .home-disclaimer-copy p {
          margin: 0;
        }

        .home-disclaimer svg {
          width: 16px;
          height: 16px;
          flex: 0 0 16px;

          stroke: ${T.bark};
          stroke-width: 2;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .compare-wrap {
          min-width: 0;
          width: 100%;
          max-width: 790px;

          justify-self: end;
          align-self: start;

          display: flex;
          flex-direction: column;
        }

        .compare-heading {
          text-align: center;
          color: ${T.bark};
          font-size: 16px;
          font-weight: 900;
          line-height: 1.2;
          margin: 0 0 14px;
        }

        .compare-frame {
          position: relative;
          width: 100%;
          aspect-ratio: 4 / 3;

          overflow: hidden;

          border: 2.5px solid ${T.bark};
          border-radius: 22px;
          background: ${T.cream};
          box-shadow: 8px 8px 0 ${T.bark};

          cursor: ew-resize;
          user-select: none;
          touch-action: none;
        }

        .compare-photo {
          position: absolute;
          inset: 0;

          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center;

          background: ${T.cream};

          pointer-events: none;
          user-select: none;
          display: block;
        }

        .compare-photo-employed { z-index: 1; }
        .compare-photo-unemployed { z-index: 2; }

        .compare-divider {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 3px;
          background: #fff;
          box-shadow: 0 0 0 1px rgba(49,23,9,.12);
          transform: translateX(-50%);
          z-index: 4;
          pointer-events: none;
        }

        .compare-handle {
          position: absolute;
          top: 50%;

          width: 54px;
          height: 54px;
          border-radius: 50%;

          background: ${T.cream};
          border: 2px solid rgba(49,23,9,.18);
          box-shadow: 0 5px 16px rgba(49,23,9,.16);

          transform: translate(-50%,-50%);
          z-index: 5;

          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;

          color: ${T.bark};
          font-family: ${SANS_UI};
          font-size: 24px;
          font-weight: 900;

          pointer-events: none;
        }

        .compare-handle span { line-height: 1; }

        .compare-info-panel {
          width: 100%;
          margin-top: 12px;

          border: 1.5px solid rgba(49,23,9,.16);
          border-radius: 14px;
          background: rgba(254,248,223,.72);

          padding: 11px 14px;

          display: flex;
          align-items: flex-start;
          gap: 10px;
        }

        .compare-info-panel-icon {
          width: 22px;
          height: 22px;
          flex: 0 0 22px;

          border-radius: 50%;
          border: 1.5px solid ${T.bark};

          display: grid;
          place-items: center;

          font-size: 11px;
          font-weight: 900;
          color: ${T.bark};
        }

        .compare-info-panel-copy {
          color: ${T.bark};
          font-size: 11.5px;
          line-height: 1.35;
          font-weight: 600;
        }

        .compare-info-panel-copy span {
          display: block;
          margin-top: 2px;

          color: ${T.fade};
          font-size: 10px;
          line-height: 1.3;
          font-weight: 500;
        }

        @media (max-width: 1240px) {
          .home-hero-grid {
            grid-template-columns: minmax(450px, .9fr) minmax(520px, 1.1fr);
            gap: 44px;
          }

          .compare-wrap {
            max-width: 710px;
          }

          .proof-copy strong {
            font-size: 16.5px;
          }

          .proof-copy span {
            font-size: 10.5px;
          }
        }

        @media (max-width: 1080px) {
          .home-hero-grid {
            grid-template-columns: 1fr;
            gap: 42px;
            padding-bottom: 46px;
          }

          .home-copy {
            max-width: 720px;
          }

          .compare-wrap {
            width: 100%;
            max-width: 760px;
            justify-self: center;
          }
        }

        @media (max-width: 620px) {
          .home-proof-row {
            grid-template-columns: 1fr;
          }

          .proof-copy strong { font-size: 17px; }
          .proof-copy span { font-size: 11px; }

          .compare-frame {
            border-radius: 18px;
            box-shadow: 6px 6px 0 ${T.bark};
          }

          .compare-handle {
            width: 44px;
            height: 44px;
            font-size: 21px;
          }
        }

        .screen-stage {
          position: relative;
          animation: screenEnter .46s cubic-bezier(.22,.8,.25,1) both;
          will-change: transform, opacity;
        }

        .screen-stage.forward {
          --screen-x: 22px;
        }

        .screen-stage.backward {
          --screen-x: -22px;
        }

        @keyframes screenEnter {
          from {
            opacity: 0;
            transform: translateX(var(--screen-x, 18px)) translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateX(0) translateY(0);
          }
        }

        .confetti-layer {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 999;
        }

        .confetti-piece {
          position: absolute;
          top: var(--y);
          left: var(--x);
          width: var(--w);
          height: var(--h);
          border-radius: var(--r);
          background: var(--c);
          opacity: 0;
          transform: translate3d(0,0,0) rotate(0deg);
          animation: confettiSideBurst var(--d) cubic-bezier(.12,.68,.22,1) var(--delay) forwards;
        }

        @keyframes confettiSideBurst {
          0% {
            opacity: 0;
            transform: translate3d(0,0,0) rotate(0deg) scale(.75);
          }
          7% {
            opacity: 1;
          }
          62% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform:
              translate3d(var(--travel-x), var(--travel-y), 0)
              rotate(var(--rot))
              scale(1);
          }
        }

        .confetti-pop {
          position: absolute;
          top: var(--y);
          left: var(--x);
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--c);
          opacity: 0;
          animation: confettiPop var(--d) ease-out var(--delay) forwards;
        }

        @keyframes confettiPop {
          0% {
            opacity: 0;
            transform: translate3d(0,0,0) scale(.3);
          }
          12% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--travel-x), var(--travel-y),0) scale(1.1);
          }
        }

        .printer-stage {
          position: relative;
          padding-top: 92px;
          margin-bottom: 30px;
        }
        .printer-shell {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: calc(100% - 24px);
          height: 108px;
          z-index: 5;
          border: 3px solid ${T.bark};
          border-radius: 28px 28px 20px 20px;
          background: linear-gradient(180deg, #FFF9E7 0%, #F3E6C4 100%);
          box-shadow:
            0 10px 0 rgba(49,23,9,.18),
            0 20px 34px rgba(49,23,9,.13);
          overflow: hidden;
          animation: printerIn .45s ease both;
        }
        .printer-shell::before {
          content: "";
          position: absolute;
          inset: 10px 18px auto;
          height: 20px;
          border-radius: 999px;
          background: rgba(255,255,255,.62);
          filter: blur(2px);
        }
        .printer-slot {
          position: absolute;
          left: 4%;
          right: 4%;
          bottom: 16px;
          height: 15px;
          border-radius: 999px;
          background: ${T.bark};
          box-shadow:
            inset 0 3px 0 rgba(0,0,0,.22),
            0 2px 0 rgba(255,255,255,.5);
        }
        .printer-slot::after {
          content: "";
          position: absolute;
          left: 3%;
          right: 3%;
          top: 4px;
          height: 2px;
          border-radius: 999px;
          background: rgba(255,213,61,.6);
        }
        .printer-paper-mask {
          position: relative;
          overflow: hidden;
          padding-top: 0;
          margin-top: -18px;
        }
        .printer-paper {
          position: relative;
          z-index: 2;
          transform-origin: top center;
          animation: paperFeed 2.35s cubic-bezier(.22,.78,.24,1) .22s both;
        }
        .printer-paper::before {
          content: "";
          position: absolute;
          left: 5%;
          right: 5%;
          top: -8px;
          height: 14px;
          border-radius: 50%;
          background: rgba(49,23,9,.12);
          filter: blur(8px);
          z-index: -1;
        }
        .printer-controls-reveal {
          animation: controlsReveal .45s ease 2.7s both;
        }
        @keyframes printerIn {
          from { opacity:0; transform:translateX(-50%) translateY(-10px) scale(.985); }
          to { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes paperFeed {
          0% {
            opacity: 0;
            transform: translateY(-82%) scaleY(.992);
          }
          8% {
            opacity: 1;
          }

          /* first short feed */
          24% {
            opacity: 1;
            transform: translateY(-64%) scaleY(.996);
          }

          /* deliberate printer pause */
          40% {
            transform: translateY(-64%) scaleY(.996);
          }

          /* main paper feed */
          84% {
            transform: translateY(-4%) scaleY(1);
          }

          /* tiny mechanical pause before release */
          91% {
            transform: translateY(-4%) scaleY(1);
          }

          /* final settle */
          96% {
            transform: translateY(5px) scaleY(1);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scaleY(1);
          }
        }
        @keyframes controlsReveal {
          from { opacity:0; transform:translateY(10px); }
          to { opacity:1; transform:translateY(0); }
        }
        @media (prefers-reduced-motion: reduce){ .seal,.card,.rise,.hard,.printer-shell,.printer-paper,.printer-controls-reveal,.screen-stage,.confetti-piece{ animation:none !important; transition:none !important } }
      `}</style>

      <div style={{ maxWidth: screen === 0 ? 1440 : 1180, margin: "0 auto", padding: screen === 0 ? "24px 34px 24px" : "26px 20px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: screen === 0 ? 30 : 42 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <img
              src="/header-logo.png"
              alt="Multipl"
              style={{ width: 174, maxWidth: "42vw", height: "auto", display: "block" }}
            />
          </div>
          {screen > 0 && screen < 4 && (
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: T.bark, opacity: 0.65 }}>
              {String(screen).padStart(2, "0")} / 03
            </span>
          )}
        </div>

        <div key={screen} className={`screen-stage ${screenDirection}`}>
        {/* 0 — landing */}
        {screen === 0 && (
          <div className="home-hero-grid">
            <div className="home-copy rise">
              <div className="home-eyebrow-wrap">
                <Eyebrow>The 40-second hiring desk</Eyebrow>
              </div>

              <div className="home-copy-main">
                <h1
                  style={{
                    fontFamily: DISPLAY_UI,
                    fontSize: "clamp(62px,4.85vw,86px)",
                    lineHeight: 0.98,
                    fontWeight: 900,
                    maxWidth: 600,
                    letterSpacing: "-4px",
                  }}
                >
                  Your money has been unemployed{" "}
                  <i className="ui-highlight" style={{ color: T.rust }}>
                    since day one.
                  </i>
                </h1>

                <p
                  style={{
                    fontSize: 19,
                    lineHeight: 1.48,
                    maxWidth: 565,
                  }}
                >
                  Same money you already plan to spend. Write its appointment letter,
                  post it, and it's in the running for this week's prize.
                </p>
              </div>

              <div className="home-cta-row">
                <button onClick={() => navigateTo(1)} className="hard" style={cta()}>
                  Start hiring ↗
                </button>
              </div>

              <div className="home-proof-row">
                <ProofCard type="download" k="1M+" v="downloads" />
                <ProofCard type="shield" k="AMFI" v="registered" />
                <ProofCard type="people" k="100+" v="brand partners" />
              </div>

              <div className="home-disclaimer">
                <div className="home-disclaimer-copy">
                  <p>
                    Multipl is a AMFI registered Mutual Fund Distributor (ARN No. 319633).*Based on historical returns of Liquid Fund category.
                  </p>
                  <p>
                    <strong>Warning:</strong> Investment in securities market are subject to market risks. Read all the related documents carefully before investing.
                  </p>
                  <p>
                    <strong>Disclaimer:</strong> Registration granted by SEBI, enlistment with BSE and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.
                  </p>
                </div>
              </div>
            </div>

            <div className="compare-wrap">
              <div className="compare-heading">Drag to see the difference</div>
              <MoneyCompareSlider />
            </div>
          </div>
        )}

        {/* 1 — jobs */}
        {screen === 1 && (
          <div className="rise">
            <Eyebrow>Step one</Eyebrow>
            <Head>Which money is <i className="ui-highlight" style={{ color: T.rust }}>out of work?</i></Head>
            <P>Tick everything that sits in your bank waiting to be spent. Pick at least two.</P>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(264px,1fr))", gap: 14 }}>
              {JOBS.map((j) => {
                const on = picked[j.id] !== undefined;
                return (
                  <button key={j.id} onClick={() => toggle(j.id)} className="hard" style={{
                    textAlign: "left", padding: "15px 17px", cursor: "pointer", borderRadius: 14,
                    background: on ? T.leaf : T.cream, border: `2px solid ${T.bark}`,
                    boxShadow: `3px 3px 0 ${T.bark}`, color: on ? "#fff" : T.bark,
                    display: "flex", gap: 12, alignItems: "center", fontFamily: SANS_UI,
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                      border: `2px solid ${on ? "#fff" : T.bark}`,
                      background: on ? "#fff" : "transparent", color: T.leaf,
                      fontSize: 14, display: "grid", placeItems: "center", fontWeight: 800,
                    }}>{on ? "✓" : ""}</span>
                    <span>
                      <span
                        style={{
                          fontSize: 15.5,
                          fontWeight: 700,
                          display: "block",
                          lineHeight: 1.15,
                          marginBottom: 6,
                        }}
                      >
                        {j.label}
                      </span>
                      <span
                        style={{
                          fontSize: 12.5,
                          opacity: on ? 0.9 : 0.6,
                          display: "block",
                          lineHeight: 1.35,
                        }}
                      >
                        {j.tag}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Nav back={() => navigateTo(0)} next={() => navigateTo(2)} disabled={chosen.length < 2}
              label={chosen.length < 2 ? `Pick ${2 - chosen.length} more` : `Continue with ${chosen.length} ↗`} />
          </div>
        )}

        {/* 2 — salary */}
        {screen === 2 && (
          <div className="rise">
            <Eyebrow>Step two</Eyebrow>
            <Head>Set the <i className="ui-highlight" style={{ color: T.rust }}>salary.</i></Head>
            <P>Roughly what sits there each month. Ranges only, so nothing exact goes on the letter.</P>
            {chosen.map((k) => {
              const j = JOBS.find((x) => x.id === k);
              return (
                <div key={k} style={{ marginBottom: 16, background: T.cream, border: `2px solid ${T.bark}`,
                  boxShadow: `3px 3px 0 ${T.bark}`, borderRadius: 14, padding: "16px 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 700 }}>{j.label}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: T.moss }}>{BANDS[picked[k]].label}</span>
                  </div>
                  <input type="range" min="0" max="4" step="1" value={picked[k]} aria-label={j.label}
                    onChange={(e) => setPicked((p) => ({ ...p, [k]: +e.target.value }))} />
                </div>
              );
            })}
            <div style={{ background: T.leaf, border: `2px solid ${T.bark}`, boxShadow: `4px 4px 0 ${T.bark}`,
              borderRadius: 16, padding: "20px 24px", marginTop: 24, color: "#fff" }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.4, marginBottom: 6, opacity: 0.9 }}>
                TOTAL PAYROLL
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span
                  style={{
                    fontFamily: "'DM Serif Display', Georgia, serif",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: 46,
                    lineHeight: 1,
                  }}
                >
                  {inr(total)}
                </span>
                <span
                  style={{
                    fontSize: 17,
                    fontFamily: SANS_UI,
                    fontWeight: 500,
                  }}
                >
                  a month
                </span>
              </div>
            </div>
            <Nav back={() => navigateTo(1)} next={() => navigateTo(3)} label="Continue ↗" />
          </div>
        )}

        {/* 3 — employer */}
        {screen === 3 && (
          <div className="rise">
            <Eyebrow>Step three</Eyebrow>
            <Head>Sign as the <i className="ui-highlight" style={{ color: T.rust }}>employer.</i></Head>
            <P>You're the Chief Money Officer here. This only prints on the letter.</P>
            <Field label="YOUR NAME" value={name} onChange={setName} placeholder="Aarav Menon" />
            <Field label="CITY" value={city} onChange={setCity} placeholder="Bengaluru" />
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.2, marginBottom: 12, opacity: 0.7 }}>
                WHEN DID YOU OPEN YOUR FIRST BANK ACCOUNT?
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {DECADES.map((d) => (
                  <button key={d.id} onClick={() => setDecade(d.id)} className="hard" style={{
                    padding: "14px 24px", cursor: "pointer", fontSize: 15.5, fontWeight: 700, borderRadius: 999,
                    background: decade === d.id ? T.leaf : T.cream, color: decade === d.id ? "#fff" : T.bark,
                    border: `2px solid ${T.bark}`, boxShadow: `3px 3px 0 ${T.bark}`, fontFamily: SANS_UI,
                  }}>{d.label}</button>
                ))}
              </div>
            </div>
            <Nav back={() => navigateTo(2)} next={issue} disabled={!decade} label="Issue the letter ↗" />
          </div>
        )}

        {/* 4 — letter */}
        {screen === 4 && (
          <div>
            <div className="printer-stage">
              <div className="printer-shell" aria-hidden="true">
                <div className="printer-slot" />
              </div>

              <div className="printer-paper-mask">
                <div className="printer-paper">
                  <div
                    className="card"
                    style={{
                      borderRadius: 18,
                      overflow: "hidden",
                      border: `3px solid ${T.bark}`,
                      boxShadow: `10px 10px 0 ${T.bark}`,
                    }}
                  >
                    <Letter data={letterData} svgRef={svgRef} sealed={sealed} />
                  </div>
                </div>
              </div>
            </div>

            <div className="printer-controls-reveal" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
              <button onClick={download} className="hard" style={cta()}>Download the letter ↗</button>
              <button onClick={copyCaption} className="hard" style={ghost()}>
                {copied ? "Caption copied" : "Copy the caption"}
              </button>
              <button onClick={() => navigateTo(1)} className="hard" style={ghost()}>Change the terms</button>
            </div>
            <div className="printer-controls-reveal" style={{ background: T.leaf, border: `2px solid ${T.bark}`, boxShadow: `5px 5px 0 ${T.bark}`,
              borderRadius: 18, padding: 30, color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: T.sun }} />
                <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.4 }}>READY WHEN YOU ARE</span>
              </div>
              <div style={{ fontFamily: DISPLAY_UI, fontSize: 38, fontWeight: 900, marginBottom: 12, lineHeight: 1.1, letterSpacing: "-3px" }}>
                Make it <i className="ui-highlight" style={{ color: T.sun }}>official.</i>
              </div>
              <p
                style={{
                  fontSize: 16.5,
                  lineHeight: 1.8,
                  fontWeight: 400,
                  margin: "0 0 26px",
                  maxWidth: 600,
                }}
              >
                Open a Multipl spending account and your money starts its first shift
                tomorrow. The joining bonus lands with your first pay-in.
              </p>
              <a
                href={CONFIG.appUrl}
                target="_blank"
                rel="noreferrer"
                className="hard"
                style={{
                  ...cta(),
                  background: T.sun,
                  color: T.bark,
                  display: "inline-block",
                  textDecoration: "none",
                }}
              >
                Get the Multipl app ↗
              </a>
              <p style={{ fontSize: 12.5, marginTop: 24, lineHeight: 1.7, maxWidth: 640, opacity: 0.92 }}>
                Posting your letter is all it takes to enter this week's draw. You do
                not need to open an account to be eligible.
              </p>
            </div>
          </div>
        )}

        </div>

      </div>
    </div>
  );
}

function MoneyCompareSlider() {
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [introAnimating, setIntroAnimating] = useState(true);
  const frameRef = useRef(null);

  useEffect(() => {
    // On first render, demonstrate the interaction:
    // middle → left → right → middle.
    const timers = [
      setTimeout(() => setPosition(16), 320),
      setTimeout(() => setPosition(84), 1120),
      setTimeout(() => setPosition(50), 2050),
      setTimeout(() => setIntroAnimating(false), 2750),
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  const updatePosition = (clientX) => {
    const el = frameRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;

    setPosition(Math.max(0, Math.min(100, next)));
  };

  const onPointerDown = (e) => {
    // If the user interacts before the intro finishes, hand control over immediately.
    setIntroAnimating(false);
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    updatePosition(e.clientX);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    updatePosition(e.clientX);
  };

  const stopDragging = (e) => {
    setDragging(false);
    if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const revealTransition = introAnimating
    ? "clip-path 720ms cubic-bezier(.22,.8,.25,1)"
    : "none";

  const sliderTransition = introAnimating
    ? "left 720ms cubic-bezier(.22,.8,.25,1)"
    : "none";

  return (
    <>
      <div
        ref={frameRef}
        className="compare-frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <img
          src="/money-employed.png"
          alt="Employed money earning with a liquid mutual fund"
          className="compare-photo compare-photo-employed"
          draggable="false"
        />

        <img
          src="/money-unemployed.png"
          alt="Unemployed money sitting idle in savings"
          className="compare-photo compare-photo-unemployed"
          draggable="false"
          style={{
            clipPath: `inset(0 ${100 - position}% 0 0)`,
            transition: revealTransition,
          }}
        />

        <div
          className="compare-divider"
          style={{
            left: `${position}%`,
            transition: sliderTransition,
          }}
        />

        <div
          className="compare-handle"
          style={{
            left: `${position}%`,
            transition: sliderTransition,
          }}
        >
          <span>‹</span>
          <span>›</span>
        </div>
      </div>

      <div className="compare-info-panel">
        <div className="compare-info-panel-icon">i</div>
        <div className="compare-info-panel-copy">
          Move your money from low returns to higher potential.
          <span>*Based on historical average returns of the liquid mutual fund category.</span>
        </div>
      </div>
    </>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 19 6v5c0 4.8-2.9 8.1-7 10-4.1-1.9-7-5.2-7-10V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 19c.6-3.4 2.6-5 5.5-5s4.9 1.6 5.5 5" />
      <path d="M14.5 15c2.8-.3 4.8 1 5.5 4" />
    </svg>
  );
}

function ProofCard({ type, k, v }) {
  const Icon = type === "download" ? DownloadIcon : type === "shield" ? ShieldIcon : PeopleIcon;

  return (
    <div className="proof-card">
      <div className="proof-icon">
        <Icon />
      </div>
      <div className="proof-copy">
        <strong>{k}</strong>
        <span>{v}</span>
      </div>
    </div>
  );
}

function ConfettiBurst() {
  const palette = ["#FFD53D", "#51A95C", "#AE4026", "#311709", "#FEF8DF", "#FFFFFF"];

  // Two strong side cannons. Deterministic values keep the render stable.
  const pieces = Array.from({ length: 92 }, (_, i) => {
    const leftSide = i % 2 === 0;
    const n = Math.floor(i / 2);

    const startY = 48 + ((n * 13) % 28);
    const travelX = 230 + ((n * 47) % 500);
    const travelY = -300 + ((n * 83) % 610);

    return {
      x: leftSide ? "-12px" : "calc(100% + 12px)",
      y: `${startY}%`,
      w: `${8 + (n % 5) * 2}px`,
      h: `${13 + (n % 6) * 3}px`,
      delay: `${((n % 10) * 0.018).toFixed(3)}s`,
      duration: `${(1.65 + (n % 8) * 0.1).toFixed(2)}s`,
      travelX: `${leftSide ? travelX : -travelX}px`,
      travelY: `${travelY}px`,
      rotation: `${(leftSide ? 1 : -1) * (300 + ((n * 91) % 720))}deg`,
      radius: n % 4 === 0 ? "999px" : n % 4 === 1 ? "3px" : "0px",
      color: palette[n % palette.length],
    };
  });

  const pops = Array.from({ length: 28 }, (_, i) => {
    const leftSide = i % 2 === 0;
    const n = Math.floor(i / 2);
    const travelX = 180 + ((n * 61) % 390);
    const travelY = -220 + ((n * 97) % 430);

    return {
      x: leftSide ? "0px" : "100%",
      y: `${53 + ((n * 17) % 20)}%`,
      delay: `${((n % 7) * 0.025).toFixed(3)}s`,
      duration: `${(1.1 + (n % 5) * 0.09).toFixed(2)}s`,
      travelX: `${leftSide ? travelX : -travelX}px`,
      travelY: `${travelY}px`,
      color: palette[(n + 2) % palette.length],
    };
  });

  return (
    <div className="confetti-layer" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={`piece-${i}`}
          className="confetti-piece"
          style={{
            "--x": p.x,
            "--y": p.y,
            "--w": p.w,
            "--h": p.h,
            "--delay": p.delay,
            "--d": p.duration,
            "--travel-x": p.travelX,
            "--travel-y": p.travelY,
            "--rot": p.rotation,
            "--r": p.radius,
            "--c": p.color,
          }}
        />
      ))}

      {pops.map((p, i) => (
        <span
          key={`pop-${i}`}
          className="confetti-pop"
          style={{
            "--x": p.x,
            "--y": p.y,
            "--delay": p.delay,
            "--d": p.duration,
            "--travel-x": p.travelX,
            "--travel-y": p.travelY,
            "--c": p.color,
          }}
        />
      ))}
    </div>
  );
}

/* ---------- chrome primitives ---------- */
const cta = () => ({
  background: T.bark, color: T.sun, border: `2px solid ${T.bark}`, borderRadius: 999,
  padding: "16px 32px", fontSize: 16.5, fontWeight: 800, cursor: "pointer",
  boxShadow: `4px 4px 0 ${T.rust}`, fontFamily: SANS_UI,
});
const ghost = () => ({
  background: T.cream, color: T.bark, border: `2px solid ${T.bark}`, borderRadius: 999,
  padding: "16px 28px", fontSize: 16.5, fontWeight: 700, cursor: "pointer",
  boxShadow: `4px 4px 0 ${T.bark}`, fontFamily: SANS_UI,
});

function Eyebrow({ children }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 18,
      background: T.bark, borderRadius: 999, padding: "9px 18px 9px 14px" }}>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: T.leaf }} />
      <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.2,
        color: T.sun, textTransform: "uppercase" }}>{children}</span>
    </div>
  );
}
const Head = ({ children }) => (
  <h2 style={{ fontFamily: DISPLAY_UI, fontSize: "clamp(32px,5.4vw,50px)", fontWeight: 800,
    margin: "0 0 10px", lineHeight: 1.08, letterSpacing: "-3px" }}>{children}</h2>
);
const P = ({ children }) => (
  <p style={{ margin: "0 0 30px", fontSize: 17, lineHeight: 1.55, maxWidth: 640, opacity: 0.85 }}>
    {children}
  </p>
);
const Stat = ({ k, v }) => (
  <div style={{ background: T.cream, border: `2px solid ${T.bark}`, boxShadow: `3px 3px 0 ${T.bark}`,
    borderRadius: 14, padding: "12px 20px" }}>
    <div style={{ fontSize: 21, fontWeight: 800 }}>{k}</div>
    <div style={{ fontSize: 13, opacity: 0.7 }}>{v}</div>
  </div>
);

function Field({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 2.2, display: "block",
        marginBottom: 8, opacity: 0.7 }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: T.cream, border: `2px solid ${T.bark}`,
          boxShadow: `3px 3px 0 ${T.bark}`, borderRadius: 12, color: T.bark, fontSize: 19,
          padding: "14px 16px", outline: "none", fontFamily: SANS_UI, fontWeight: 600 }} />
    </div>
  );
}

function Nav({ back, next, disabled, label }) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 36, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={back} className="hard" style={ghost()}>Back</button>
      <button onClick={next} disabled={disabled} className={disabled ? "" : "hard"} style={{
        ...cta(),
        background: disabled ? "rgba(49,23,9,.12)" : T.bark,
        color: disabled ? "rgba(49,23,9,.5)" : T.sun,
        boxShadow: disabled ? "none" : `4px 4px 0 ${T.rust}`,
        border: `2px solid ${disabled ? "rgba(49,23,9,.25)" : T.bark}`,
        cursor: disabled ? "not-allowed" : "pointer",
      }}>{label}</button>
    </div>
  );
}