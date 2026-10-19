// 침해 정보 대조 API — 로그인한 사용자만. CISA KEV 와 NVD 공식 목록에서
// 실제로 조회해 내 제품 의존성과 대조합니다. 결과는 6시간 캐시하고
// fetchedAt(실제로 받아 온 시각)을 응답에 담습니다. 캐시 안에는 받은 시각이
// 그대로 남습니다. 조회 실패는 성공으로 꾸미지 않고 503으로 돌려줍니다.
import { readFileSync } from 'node:fs';
import { sessionAuth } from '../src/server-session.mjs';
import { createLoginVerifier } from '../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const CACHE_MS = 6 * 60 * 60 * 1000; // 6시간 캐시(계약)
const FETCH_TIMEOUT_MS = 15_000;

// 내 제품이 실제로 쓰는 구성 요소 — package.json 의 의존성에서 읽습니다.
const components = Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({ name, version }));

let cache = null; // { at, body }
let verifier = null;
const verify = () => verifier ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });

// 공식 목록의 표기와 내 의존성 이름이 정확히 같지 않을 수 있어 비교용 꼬리표를 둡니다.
const aliases = name => ({
  '@supabase/supabase-js': ['supabase-js', 'supabase'],
  'jose': ['jose'],
}[name] ?? [name.replace(/^@[^/]+\//u, '')]);

async function nvdLookup(name) {
  const url = `${NVD_URL}?keywordSearch=${encodeURIComponent(name)}&resultsPerPage=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 429 || res.status === 503) return { error: `nvd_http_${res.status}` };
  if (!res.ok) return { error: `nvd_http_${res.status}` };
  const body = await res.json();
  const items = (body?.vulnerabilities ?? []).map(v => ({
    id: v?.cve?.id, published: v?.cve?.published,
    severity: v?.cve?.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity
      ?? v?.cve?.metrics?.cvssMetricV40?.[0]?.cvssData?.baseSeverity ?? null,
  })).filter(v => typeof v.id === 'string');
  return { total: body?.totalResults ?? items.length, items };
}

const handler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let identity;
  try { identity = await verify()(req.headers?.authorization ?? req.headers?.Authorization ?? ''); }
  catch { identity = null; }
  if (!identity) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return res.status(200).json({ ...cache.body, cached: true, ageMs: now - cache.at });
  }
  try {
    const kevRes = await fetch(KEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!kevRes.ok) return res.status(503).json({ error: 'THREAT_INTEL_UNAVAILABLE', detail: `kev_http_${kevRes.status}` });
    const kev = await kevRes.json();
    const kevRows = Array.isArray(kev?.vulnerabilities) ? kev.vulnerabilities : [];
    const fetchedAt = new Date(now).toISOString();

    const checks = [];
    for (const { name, version } of components) {
      const tails = aliases(name);
      const kevHits = kevRows
        .filter(v => tails.some(t => `${v.vendorProject ?? ''} ${v.product ?? ''} ${v.vulnerabilityName ?? ''}`.toLowerCase().includes(t)))
        .map(v => ({ id: v.cveID, name: v.vulnerabilityName, dueDate: v.dueDate }));
      // NVD 는 무키 호출이 조밀한 제한이 있어 구성 요소당 한 번만 묻습니다.
      const nvd = await nvdLookup(tails[0]).catch(() => ({ error: 'nvd_unreachable' }));
      checks.push({ component: name, version, kev: kevHits, nvd });
    }
    const body = {
      schema: 'aleph.threat-intel.v1',
      fetchedAt,
      cacheTtlSeconds: CACHE_MS / 1000,
      sources: [
        { name: 'CISA KEV', url: KEV_URL, entries: kevRows.length },
        { name: 'NVD CVE 2.0', url: NVD_URL },
      ],
      checks,
    };
    cache = { at: now, body };
    return res.status(200).json({ ...body, cached: false });
  } catch {
    return res.status(503).json({ error: 'THREAT_INTEL_UNAVAILABLE' });
  }
};

export default sessionAuth.wrap(handler);
