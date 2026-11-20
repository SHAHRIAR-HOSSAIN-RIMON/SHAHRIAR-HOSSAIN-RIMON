// Generates an animated SVG of a little rover robot driving across your
// GitHub contribution graph and scanning up every contribution square.
//
// Usage:
//   GITHUB_TOKEN=... GITHUB_USER=yourname node scripts/robot.mjs
//   node scripts/robot.mjs --demo        (random data, no token needed)
//
// Writes: <OUT_DIR>/robot-contrib.svg and <OUT_DIR>/robot-contrib-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USER = process.env.GITHUB_USER || "";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OUT_DIR = process.env.OUT_DIR || "dist";
const DEMO = process.argv.includes("--demo") || !TOKEN;

// ---------- layout + timing ----------
const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP;
const PAD_X = 22;
const TOP = 40; // room for header text + robot above row 0
const BOTTOM = 18;
const SEC_PER_CELL = 0.055; // robot speed
const INTRO = 0.9; // grid fades in before the robot arrives
const OUTRO = 1.4; // empty grid after the robot leaves
const BEAM = "#D65D0E";

const THEMES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    text: "#57606a",
    accent: "#AF3A03",
    body: "#E2E8F0",
    outline: "#334155",
    tread: "#334155",
    wheel: "#94A3B8",
    visor: "#0F172A",
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    text: "#8b949e",
    accent: "#E78A4E",
    body: "#CBD5E1",
    outline: "#64748B",
    tread: "#1E293B",
    wheel: "#64748B",
    visor: "#0F172A",
  },
};

const LEVEL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// ---------- data ----------
async function fetchCalendar() {
  if (DEMO) return demoCalendar();
  if (!USER) throw new Error("Set GITHUB_USER");
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { weekday contributionCount contributionLevel } }
        }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "robot-contrib-generator",
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) =>
      w.contributionDays.map((d) => ({ wd: d.weekday, level: LEVEL[d.contributionLevel] ?? 0 }))
    ),
  };
}

function demoCalendar() {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const weeks = [];
  let total = 0;
  for (let w = 0; w < 53; w++) {
    const days = [];
    const lastDays = w === 52 ? 4 : 7; // partial final week, like the real calendar
    for (let d = 0; d < lastDays; d++) {
      const r = rnd();
      const level = r < 0.55 ? 0 : r < 0.75 ? 1 : r < 0.88 ? 2 : r < 0.96 ? 3 : 4;
      total += level * 2;
      days.push({ wd: d, level });
    }
    weeks.push(days);
  }
  return { total, weeks };
}

// ---------- svg ----------
const pct = (t, T) => ((t / T) * 100).toFixed(3) + "%";
const cx = (x) => PAD_X + x * STEP + CELL / 2;
const cy = (y) => TOP + y * STEP + CELL / 2;

function robotShape(c) {
  // A boxy rover: antenna, visor with two eyes, tank treads. Drawn around (0,0).
  return `
      <line x1="0" y1="-8" x2="0" y2="-12" stroke="${c.outline}" stroke-width="1.2" stroke-linecap="round"/>
      <circle class="tip" cx="0" cy="-13" r="1.7" fill="${BEAM}"/>
      <rect x="-8" y="-8" width="16" height="12" rx="3" fill="${c.body}" stroke="${c.outline}" stroke-width="1"/>
      <rect x="-6" y="-6" width="12" height="6" rx="2" fill="${c.visor}"/>
      <circle class="eye" cx="-2.6" cy="-3" r="1.3" fill="${BEAM}"/>
      <circle class="eye" cx="2.6" cy="-3" r="1.3" fill="${BEAM}"/>
      <rect x="-9" y="4" width="18" height="5" rx="2.5" fill="${c.tread}"/>
      <circle cx="-5.5" cy="6.5" r="1.3" fill="${c.wheel}"/>
      <circle cx="0" cy="6.5" r="1.3" fill="${c.wheel}"/>
      <circle cx="5.5" cy="6.5" r="1.3" fill="${c.wheel}"/>`;
}

function buildSvg({ total, weeks }, c) {
  // Serpentine route: down even columns, up odd columns.
  const cells = [];
  weeks.forEach((week, x) => {
    const days = [...week].sort((a, b) => a.wd - b.wd);
    if (x % 2) days.reverse();
    for (const d of days) cells.push({ x, y: d.wd, level: d.level });
  });

  const cols = weeks.length;
  const width = PAD_X * 2 + cols * STEP - GAP;
  const height = TOP + 7 * STEP - GAP + BOTTOM;

  // Waypoints: enter from the left, visit every cell, exit right.
  const first = cells[0];
  const last = cells[cells.length - 1];
  const points = [
    { px: cx(-3), py: cy(first.y) },
    ...cells.map((cell) => ({ px: cx(cell.x), py: cy(cell.y), cell })),
    { px: cx(cols + 2), py: cy(last.y) },
  ];

  // Arrival time at each waypoint (constant speed).
  let t = INTRO;
  points[0].t = t;
  for (let i = 1; i < points.length; i++) {
    const dist = Math.hypot(points[i].px - points[i - 1].px, points[i].py - points[i - 1].py) / STEP;
    t += dist * SEC_PER_CELL;
    points[i].t = t;
  }
  const T = t + OUTRO;

  // Robot movement keyframes.
  const move = [`0%{transform:translate(${points[0].px}px,${points[0].py}px)}`];
  for (const p of points) move.push(`${pct(p.t, T)}{transform:translate(${p.px}px,${p.py}px)}`);
  move.push(`100%{transform:translate(${points.at(-1).px}px,${points.at(-1).py}px)}`);

  // Per-cell keyframes: fade in, flash cyan when scanned, then go empty.
  const empty = c.levels[0];
  const css = [];
  const rects = [];
  let k = 0;
  for (const p of points) {
    if (!p.cell) continue;
    const { x, y, level } = p.cell;
    const rx = PAD_X + x * STEP;
    const ry = TOP + y * STEP;
    if (level === 0) {
      rects.push(`<rect x="${rx}" y="${ry}" width="${CELL}" height="${CELL}" rx="2" fill="${empty}"/>`);
      continue;
    }
    const color = c.levels[level];
    const name = `c${k++}`;
    css.push(
      `@keyframes ${name}{0%{fill:${empty}}${pct(INTRO * 0.8, T)},${pct(p.t - 0.04, T)}{fill:${color}}` +
        `${pct(p.t, T)}{fill:${BEAM}}${pct(p.t + 0.45, T)},100%{fill:${empty}}}` +
        `.${name}{animation:${name} ${T.toFixed(3)}s linear infinite}`
    );
    rects.push(`<rect class="${name}" x="${rx}" y="${ry}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"/>`);
  }

  const style = `
    .bot{animation:move ${T.toFixed(3)}s linear infinite}
    @keyframes move{${move.join("")}}
    .bob{animation:bob .6s ease-in-out infinite alternate}
    @keyframes bob{from{transform:translateY(-1px)}to{transform:translateY(1px)}}
    .eye{transform-box:fill-box;transform-origin:center;animation:blink 3.2s infinite}
    @keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
    .tip{animation:tip 1s steps(1) infinite}
    @keyframes tip{0%{opacity:1}50%{opacity:.25}}
    ${css.join("\n    ")}`;

  const font = `font-family="'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="11"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>${style}
  </style>
  <text x="${PAD_X}" y="16" ${font} fill="${c.text}"><tspan fill="${c.accent}">&gt;</tspan> robot.scan(contributions)</text>
  <text x="${width - PAD_X}" y="16" ${font} fill="${c.text}" text-anchor="end">${total.toLocaleString("en-US")} contributions in the last year</text>
  <g>
    ${rects.join("\n    ")}
  </g>
  <g class="bot">
    <g class="bob">
      <g transform="scale(1.2)">${robotShape(c)}
      </g>
    </g>
  </g>
</svg>
`;
}

// ---------- main ----------
const data = await fetchCalendar();
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "robot-contrib.svg"), buildSvg(data, THEMES.light));
writeFileSync(join(OUT_DIR, "robot-contrib-dark.svg"), buildSvg(data, THEMES.dark));
console.log(`Wrote robot SVGs to ${OUT_DIR}${DEMO ? " (demo data)" : ""}`);
