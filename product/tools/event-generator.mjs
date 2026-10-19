// 제공 도구. 연습용 합성 사건을 만듭니다. 실제 사람 정보는 들어가지 않습니다.
//   node tools/event-generator.mjs --seed 42 --count 200 > events.json
// 같은 시드면 같은 사건이 나옵니다. 심판은 다른 시드·다른 순서를 씁니다.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function makeEvents({ seed = 1, count = 100, subjects = ['u-1', 'u-2'], kinds = ['read', 'write', 'login'], start = '2026-10-20T00:00:00.000Z', spanMs = 86_400_000 } = {}) {
  const r = rng(seed);
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, i) => ({
    id: `ev-${seed}-${String(i).padStart(5, '0')}`,
    at: new Date(t0 + Math.floor(r() * spanMs)).toISOString(),
    kind: kinds[Math.floor(r() * kinds.length)],
    subject: subjects[Math.floor(r() * subjects.length)],
  }));
}

export function shuffle(list, r = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('event-generator.mjs')) {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const events = makeEvents({ seed: Number(arg('seed') ?? 1), count: Number(arg('count') ?? 100) });
  process.stdout.write(`${JSON.stringify({ events }, null, 2)}\n`);
}
