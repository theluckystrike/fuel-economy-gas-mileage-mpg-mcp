// Pure core for fuel-economy-gas-mileage-mpg-mcp. The only I/O is keyless reads of the fueleconomy.gov web services
// (U.S. Department of Energy and EPA), done through an injected fetchText.
//
// Sources (public, no key, JSON with Accept: application/json):
//   https://www.fueleconomy.gov/ws/rest/vehicle/menu/year                         model years, newest first
//   https://www.fueleconomy.gov/ws/rest/vehicle/menu/make?year=Y                  makes for a year
//   https://www.fueleconomy.gov/ws/rest/vehicle/menu/model?year=Y&make=M          models for a year and make ("RAV4 AWD XLE")
//   https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=Y&make=M&model=X  versions: text "Auto (AV-S6), 4 cyl, 2.5 L", value = vehicle id
//   https://www.fueleconomy.gov/ws/rest/vehicle/<id>                              one EPA vehicle record
//   https://www.fueleconomy.gov/ws/rest/ympg/shared/ympgVehicle/<id>              My MPG driver reports (204 empty body when none)
//   https://www.fueleconomy.gov/ws/rest/fuelprices                                national average fuel prices used by fueleconomy.gov
// A menu with one entry is an object, not an array; an unknown model answers the literal "null".
//
// Vehicle record fields used (checked against live records 2026-11-17):
//   city08/highway08/comb08   EPA label MPG for fuelType1 (MPGe for an EV); city08U etc. are unrounded
//   cityA08/highwayA08/combA08  MPG or MPGe on fuelType2 (electricity for a plug-in hybrid, E85 for a flex-fuel car)
//   cityE/highwayE/combE      kWh per 100 miles (EV, or a plug-in hybrid on electricity)
//   range                     EV range in miles; for a plug-in hybrid the total range. rangeA: plug-in hybrid electric range
//   combinedUF                EPA utility factor: share of miles a plug-in hybrid drives on electricity
//   fuelCost08                EPA annual fuel cost in dollars (15,000 miles, 55% city, current prices, rounded to $50)
//   youSaveSpend              dollars saved (positive) or spent (negative) on fuel over 5 years against the average new vehicle
//   co2TailpipeGpm            tailpipe CO2 in grams per mile; feScore/ghgScore 1-10 (-1 = not rated)
//   atvType                   "", Hybrid, Plug-in Hybrid, EV, FCV, Diesel, FFV, CNG, Bifuel (CNG) ...; mpgData "Y" when My MPG has reports
import type { FetchText } from './types.js';

export const REPO = 'fuel-economy-gas-mileage-mpg-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const BASE = 'https://www.fueleconomy.gov/ws/rest';
export const SOURCE =
  'U.S. Department of Energy and EPA fuel economy data (fueleconomy.gov web services). MPG and MPGe are EPA label values; annual fuel cost assumes 15,000 miles a year, ' +
  '55% city, at the national average prices fueleconomy.gov uses. My MPG figures are voluntary driver reports.';
export const EPA_MILES = 15000;
export const EPA_CITY = 0.55;
const MAX_MODELS = 10;
const MAX_VEHICLES = 12;
const MAX_YMPG = 6;

export class InputError extends Error {}
export class UpstreamError extends Error {}

const enc = encodeURIComponent;
const r2 = (x: number) => Math.round(x * 100) / 100;
const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const usd2 = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function num(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
const pos = (x: unknown) => { const v = num(x); return v !== null && v > 0 ? v : null; };

async function getJson(f: FetchText, path: string, ttl = 86400): Promise<any> {
  let body: string;
  try {
    body = await f(`${BASE}/${path}`, { accept: 'application/json', cacheTtl: ttl, timeoutMs: 15000 });
  } catch (e) {
    throw new UpstreamError(`fueleconomy.gov did not answer (${(e as Error).message}) for ${path.split('?')[0]}`);
  }
  const t = body.trim();
  if (t === '' || t === 'null') return null;
  try { return JSON.parse(t); } catch { throw new UpstreamError(`fueleconomy.gov returned something that is not JSON for ${path.split('?')[0]}`); }
}

export interface MenuItem { text: string; value: string }
export function menuItems(j: any): MenuItem[] {
  const m = j?.menuItem;
  if (!m) return [];
  return (Array.isArray(m) ? m : [m]).map((x: any) => ({ text: String(x.text), value: String(x.value) }));
}

/** Lowercased word tokens: hyphens and apostrophes join ("F-150" -> f150, "Mach-E" -> mache), other punctuation splits. */
export function tokens(s: string): string[] {
  return String(s ?? '').toLowerCase().replace(/[-'’]/g, '').replace(/[^a-z0-9.]+/g, ' ').trim().split(' ').filter(Boolean);
}

type Rec = Record<string, any>;
const ATTRS: Record<string, { label: string; test: (v: Rec) => boolean }> = {
  hybrid: { label: 'hybrid', test: (v) => /hybrid/i.test(v.atvType ?? '') },
  hev: { label: 'hybrid', test: (v) => /hybrid/i.test(v.atvType ?? '') },
  phev: { label: 'plug-in hybrid', test: (v) => /plug-in/i.test(v.atvType ?? '') },
  plugin: { label: 'plug-in hybrid', test: (v) => /plug-in/i.test(v.atvType ?? '') },
  ev: { label: 'electric', test: (v) => v.atvType === 'EV' || /^electricity$/i.test(v.fuelType1 ?? '') },
  electric: { label: 'electric', test: (v) => v.atvType === 'EV' || /^electricity$/i.test(v.fuelType1 ?? '') },
  bev: { label: 'electric', test: (v) => v.atvType === 'EV' || /^electricity$/i.test(v.fuelType1 ?? '') },
  awd: { label: 'AWD or 4WD', test: (v) => /all-wheel|4-wheel|4wd|awd/i.test(v.drive ?? '') },
  '4wd': { label: 'AWD or 4WD', test: (v) => /all-wheel|4-wheel|4wd|awd/i.test(v.drive ?? '') },
  '4x4': { label: 'AWD or 4WD', test: (v) => /all-wheel|4-wheel|4wd|awd/i.test(v.drive ?? '') },
  fwd: { label: 'front-wheel drive', test: (v) => /front/i.test(v.drive ?? '') },
  rwd: { label: 'rear-wheel drive', test: (v) => /rear/i.test(v.drive ?? '') },
  '2wd': { label: '2WD', test: (v) => /front|rear|2-wheel/i.test(v.drive ?? '') },
  diesel: { label: 'diesel', test: (v) => /diesel/i.test(v.fuelType1 ?? '') },
};
const NAME_SYN: Record<string, string[]> = { hybrid: ['hybrid', 'hev'], hev: ['hybrid', 'hev'], phev: ['phev', 'plugin'], plugin: ['phev', 'plugin'], ev: ['ev'], electric: ['ev', 'electric'], awd: ['awd', '4wd'], '4wd': ['4wd', 'awd'], '4x4': ['4wd', 'awd'] };

const MAKE_ALIASES: Record<string, string> = {
  chevy: 'chevrolet', vw: 'volkswagen', mercedes: 'mercedesbenz', benz: 'mercedesbenz', mb: 'mercedesbenz', alfa: 'alfaromeo', landrover: 'landrover',
  rangerover: 'landrover', mini: 'mini', caddy: 'cadillac', lambo: 'lamborghini', merc: 'mercedesbenz',
};
const squash = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchMake(makes: string[], q: string): string | null {
  const s = squash(q);
  if (!s) return null;
  const a = MAKE_ALIASES[s] ?? s;
  const exact = makes.find((m) => squash(m) === a);
  if (exact) return exact;
  const pre = makes.filter((m) => squash(m).startsWith(a));
  return pre.length === 1 ? pre[0] : null;
}

export interface Query { base: string[]; attrs: string[]; extra: string[] }
/** Split a model query (+ optional trim words) into name words, attribute words (hybrid, AWD ...) and trim words. */
export function parseQuery(model: string, trim?: string): Query {
  const mt = tokens(model);
  const tt = tokens(trim ?? '');
  const base = mt.filter((t) => !ATTRS[t]);
  const attrs = [...new Set([...mt, ...tt].filter((t) => ATTRS[t]))];
  const extra = tt.filter((t) => !ATTRS[t]);
  if (!base.length) throw new InputError(`"${model}" has no model name in it. Give a model such as "RAV4", "F-150" or "Model Y", and put words like hybrid or AWD in trim.`);
  return { base, attrs, extra };
}
const hasTok = (toks: string[], q: string) => toks.some((t) => t === q || t.startsWith(q));

/** Models whose first word starts with the first query word; other words are required on the name when any candidate has them. */
export function matchModels(models: string[], q: Query): { models: string[]; deferred: string[] } {
  let c = models.filter((m) => { const t = tokens(m); return t.length > 0 && t[0].startsWith(q.base[0]); });
  if (!c.length) {
    const joined = q.base.join('');
    c = models.filter((m) => squash(m).startsWith(joined));
    if (c.length) return { models: c, deferred: q.extra };
    return { models: [], deferred: [] };
  }
  const deferred: string[] = [];
  for (const w of [...q.base.slice(1), ...q.extra]) {
    if (c.some((m) => hasTok(tokens(m), w))) c = c.filter((m) => hasTok(tokens(m), w));
    else deferred.push(w);
  }
  return { models: c, deferred };
}

export interface MyMpg { average_mpg: number; drivers: number; min_mpg: number | null; max_mpg: number | null; city_percent: number | null }
export function parseYmpg(body: any): MyMpg | null {
  if (!body || typeof body !== 'object') return null;
  const avg = num(body.avgMpg);
  const n = num(body.recordCount);
  if (avg === null || !n) return null;
  return { average_mpg: Math.round(avg * 10) / 10, drivers: n, min_mpg: num(body.minMpg), max_mpg: num(body.maxMpg), city_percent: num(body.cityPercent) };
}

export type Kind = 'gasoline' | 'diesel' | 'hybrid' | 'plug-in hybrid' | 'electric' | 'hydrogen fuel cell' | 'flex-fuel' | 'natural gas';
export function kindOf(v: Rec): Kind {
  const a = String(v.atvType ?? '');
  const f1 = String(v.fuelType1 ?? '');
  if (a === 'EV' || /^electricity$/i.test(f1)) return 'electric';
  if (/plug-in/i.test(a)) return 'plug-in hybrid';
  if (/hybrid/i.test(a)) return 'hybrid';
  if (a === 'FCV' || /hydrogen/i.test(f1)) return 'hydrogen fuel cell';
  if (/diesel/i.test(f1)) return 'diesel';
  if (a === 'FFV') return 'flex-fuel';
  if (/natural gas/i.test(f1)) return 'natural gas';
  return 'gasoline';
}

/** Price key in the fuelprices answer for a fuelType1 value. */
export function priceKey(fuelType1: string): string | null {
  const f = String(fuelType1 ?? '').toLowerCase();
  if (/premium/.test(f)) return 'premium';
  if (/midgrade/.test(f)) return 'midgrade';
  if (/regular/.test(f)) return 'regular';
  if (/diesel/.test(f)) return 'diesel';
  if (/e85/.test(f)) return 'e85';
  if (/natural gas/.test(f)) return 'cng';
  if (/propane/.test(f)) return 'lpg';
  if (/electricity/.test(f)) return 'electric';
  return null;
}

export interface VehicleRow {
  id: number; year: number; make: string; model: string; base_model: string; version: string; powertrain: Kind;
  vehicle_class: string; drive: string; transmission: string; engine: string | null; fuel: string;
  mpg: { city: number; highway: number; combined: number } | null;
  mpge: { city: number; highway: number; combined: number } | null;
  kwh_per_100_miles: number | null;
  range_miles: number | null; electric_range_miles: number | null; utility_factor: number | null;
  annual_fuel_cost: number | null; five_year_fuel_savings_vs_average_car: number | null;
  co2_grams_per_mile: number | null; fuel_economy_score: number | null; greenhouse_gas_score: number | null;
  my_mpg: MyMpg | null; url: string;
  _raw: Rec;
}

export function vehicleRow(v: Rec, version?: string, ympg: MyMpg | null = null): VehicleRow {
  const kind = kindOf(v);
  const trio = (c: unknown, h: unknown, m: unknown) => (pos(m) !== null ? { city: num(c) ?? 0, highway: num(h) ?? 0, combined: num(m) ?? 0 } : null);
  const disp = num(v.displ);
  const cyl = num(v.cylinders);
  const engine = disp && cyl ? `${cyl} cyl, ${disp} L${v.tCharger === 'T' ? ', turbo' : ''}${v.sCharger === 'S' ? ', supercharged' : ''}` : (v.evMotor ? String(v.evMotor) : null);
  const score = (x: unknown) => { const s = num(x); return s !== null && s > 0 ? s : null; };
  return {
    id: Number(v.id), year: Number(v.year), make: String(v.make), model: String(v.model), base_model: String(v.baseModel ?? v.model),
    version: version ?? [v.trany, engine].filter(Boolean).join(', '), powertrain: kind,
    vehicle_class: String(v.VClass ?? ''), drive: String(v.drive ?? ''), transmission: String(v.trany ?? ''), engine, fuel: String(v.fuelType ?? v.fuelType1 ?? ''),
    mpg: kind === 'electric' ? null : trio(v.city08, v.highway08, v.comb08),
    mpge: kind === 'electric' ? trio(v.city08, v.highway08, v.comb08) : kind === 'plug-in hybrid' && /electric/i.test(v.fuelType2 ?? '') ? trio(v.cityA08, v.highwayA08, v.combA08) : null,
    kwh_per_100_miles: pos(v.combE),
    range_miles: pos(v.range),
    electric_range_miles: kind === 'plug-in hybrid' ? pos(v.rangeA) : kind === 'electric' ? pos(v.range) : null,
    utility_factor: kind === 'plug-in hybrid' ? pos(v.combinedUF) : null,
    annual_fuel_cost: pos(v.fuelCost08),
    five_year_fuel_savings_vs_average_car: num(v.youSaveSpend),
    co2_grams_per_mile: num(v.co2TailpipeGpm),
    fuel_economy_score: score(v.feScore), greenhouse_gas_score: score(v.ghgScore),
    my_mpg: ympg,
    url: `https://www.fueleconomy.gov/feg/Find.do?action=sbs&id=${v.id}`,
    _raw: v,
  };
}

/** One line for a vehicle: name, version, MPG or MPGe, range, EPA annual fuel cost. */
export function line(r: VehicleRow): string {
  const name = `${r.year} ${r.make} ${r.model}`;
  const parts: string[] = [];
  if (r.powertrain === 'electric' && r.mpge) {
    parts.push(`${r.mpge.city} city / ${r.mpge.highway} hwy / ${r.mpge.combined} combined MPGe`);
    if (r.kwh_per_100_miles) parts.push(`${Math.round(r.kwh_per_100_miles * 10) / 10} kWh/100 mi`);
    if (r.range_miles) parts.push(`${r.range_miles} mi range`);
  } else {
    if (r.mpg) parts.push(`${r.mpg.city} city / ${r.mpg.highway} hwy / ${r.mpg.combined} combined MPG${r.powertrain === 'plug-in hybrid' ? ' on gas' : ''}`);
    if (r.powertrain === 'plug-in hybrid' && r.mpge) parts.push(`${r.mpge.combined} MPGe on electricity`);
    if (r.electric_range_miles) parts.push(`${r.electric_range_miles} mi electric range${r.range_miles ? ` (${r.range_miles} mi total)` : ''}`);
  }
  if (r.annual_fuel_cost) parts.push(`${usd(r.annual_fuel_cost)} a year in fuel`);
  if (r.my_mpg) parts.push(`drivers report ${r.my_mpg.average_mpg} MPG (${r.my_mpg.drivers} ${r.my_mpg.drivers === 1 ? 'driver' : 'drivers'})`);
  const pt = r.powertrain === 'gasoline' ? '' : `, ${r.powertrain}`;
  return `${name} (${r.version}${pt}): ${parts.join(', ')}`;
}
const pub = (r: VehicleRow) => { const { _raw, ...rest } = r; return rest; };

// ---------- menus ----------
export async function years(f: FetchText): Promise<number[]> {
  const y = menuItems(await getJson(f, 'vehicle/menu/year')).map((m) => Number(m.value)).filter((n) => n >= 1984);
  if (!y.length) throw new UpstreamError('fueleconomy.gov returned no model years');
  return y.sort((a, b) => b - a);
}
function checkYear(y: unknown, now: Date): number {
  const n = Number(y);
  if (!Number.isInteger(n) || n < 1984 || n > now.getUTCFullYear() + 1) throw new InputError(`year must be a model year from 1984 to ${now.getUTCFullYear() + 1}`);
  return n;
}
async function makesFor(f: FetchText, year: number): Promise<string[]> {
  return menuItems(await getJson(f, `vehicle/menu/make?year=${year}`)).map((m) => m.text);
}
async function modelsFor(f: FetchText, year: number, make: string): Promise<string[]> {
  return menuItems(await getJson(f, `vehicle/menu/model?year=${year}&make=${enc(make)}`)).map((m) => m.text);
}
async function optionsFor(f: FetchText, year: number, make: string, model: string): Promise<MenuItem[]> {
  return menuItems(await getJson(f, `vehicle/menu/options?year=${year}&make=${enc(make)}&model=${enc(model)}`));
}
async function record(f: FetchText, id: number | string): Promise<Rec> {
  let v: any;
  try { v = await getJson(f, `vehicle/${enc(String(id))}`); } catch (e) {
    if (/HTTP 404/.test((e as Error).message)) throw new InputError(`no fueleconomy.gov vehicle with id ${id}`);
    throw e;
  }
  if (!v || typeof v !== 'object' || !v.id) throw new InputError(`no fueleconomy.gov vehicle with id ${id}`);
  return v;
}
async function ympgFor(f: FetchText, v: Rec): Promise<MyMpg | null> {
  if (v.mpgData !== 'Y') return null;
  try { return parseYmpg(await getJson(f, `ympg/shared/ympgVehicle/${enc(String(v.id))}`)); } catch { return null; }
}

interface Resolved { year: number; make: string; models: string[]; deferred: string[]; allModels: string[]; yearNote: string | null }

/** Year (given, or the newest of the last 3 listed years that has a match), canonical make and the matching models. */
async function resolveModels(f: FetchText, a: { year?: number; make: string; model: string; trim?: string }, q: Query, now: Date): Promise<Resolved> {
  if (!a.make || !String(a.make).trim()) throw new InputError('make is required, e.g. "Toyota"');
  const tryYears = a.year !== undefined ? [checkYear(a.year, now)] : (await years(f)).filter((y) => y <= now.getUTCFullYear() + 1).slice(0, 3);
  let lastErr = '';
  for (const year of tryYears) {
    const makes = await makesFor(f, year);
    const make = matchMake(makes, a.make);
    if (!make) { lastErr = `no make "${a.make}" in model year ${year}. Makes include: ${makes.slice(0, 40).join(', ')}`; continue; }
    const all = await modelsFor(f, year, make);
    const m = matchModels(all, q);
    if (m.models.length) {
      const yearNote = a.year === undefined && year !== tryYears[0] ? `No ${make} ${a.model} is listed for ${tryYears[0]} yet, so this is model year ${year}.` : null;
      return { year, make, models: m.models, deferred: m.deferred, allModels: all, yearNote };
    }
    const first = q.base[0];
    const near = all.filter((x) => squash(x).startsWith(first.slice(0, 2)));
    lastErr = `no ${year} ${make} model matches "${a.model}". ${near.length ? `Close: ${near.slice(0, 15).join('; ')}` : `Models: ${all.slice(0, 40).join('; ')}`}`;
  }
  throw new InputError(lastErr || 'no match');
}

const passes = (v: Rec, version: string, model: string, attrs: string[], deferred: string[]) => {
  if (!attrs.every((t) => ATTRS[t].test(v))) return false;
  const toks = [...tokens(model), ...tokens(version)];
  return deferred.every((w) => hasTok(toks, w));
};

// ---------- tools ----------
export interface LookupArgs { year?: number; make: string; model: string; trim?: string }

export async function lookup(f: FetchText, a: LookupArgs, now = new Date()) {
  const q = parseQuery(a.model, a.trim);
  const r = await resolveModels(f, a, q, now);
  const notes: string[] = [];
  if (r.yearNote) notes.push(r.yearNote);
  let models = r.models;
  if (models.length > MAX_MODELS) { notes.push(`${models.length} models match; read the first ${MAX_MODELS}. Add words (trim, AWD, hybrid) to narrow it.`); models = models.slice(0, MAX_MODELS); }
  const opts = (await Promise.all(models.map(async (m) => (await optionsFor(f, r.year, r.make, m)).map((o) => ({ model: m, ...o }))))).flat();
  let wanted = opts.filter((o) => r.deferred.every((w) => hasTok([...tokens(o.model), ...tokens(o.text)], w)));
  if (wanted.length > MAX_VEHICLES) { notes.push(`${wanted.length} versions match; showing the first ${MAX_VEHICLES}.`); wanted = wanted.slice(0, MAX_VEHICLES); }
  const recs = await Promise.all(wanted.map(async (o) => ({ o, v: await record(f, o.value) })));
  const kept = recs.filter(({ o, v }) => passes(v, o.text, o.model, q.attrs, []));
  if (!kept.length) {
    const what = [...q.attrs.map((t) => ATTRS[t].label), ...r.deferred].join(', ');
    throw new InputError(`no ${what} version of the ${r.year} ${r.make} ${a.model}. Versions listed: ${recs.map(({ o, v }) => `${o.model} (${o.text}, ${kindOf(v)})`).join('; ') || 'none'}`);
  }
  let ycount = 0;
  const rows = await Promise.all(kept.map(async ({ o, v }) => vehicleRow(v, o.text, v.mpgData === 'Y' && ycount++ < MAX_YMPG ? await ympgFor(f, v) : null)));
  const eff = (x: VehicleRow) => (x.powertrain === 'electric' ? x.mpge?.combined : x.mpg?.combined) ?? 0;
  const gas = rows.filter((x) => x.powertrain !== 'electric' && x.mpg);
  const ev = rows.filter((x) => x.powertrain === 'electric' && x.mpge);
  const span = (xs: VehicleRow[], unit: string) => {
    if (!xs.length) return '';
    const v = xs.map(eff);
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi ? `${hi} combined ${unit}` : `${lo} to ${hi} combined ${unit}`;
  };
  const spans = [span(gas, 'MPG'), span(ev, 'MPGe')].filter(Boolean).join('; ');
  const head = `${r.year} ${r.make} ${a.model}${a.trim ? ` ${a.trim}` : ''}: ${rows.length} ${rows.length === 1 ? 'version' : 'versions'}, ${spans}.`;
  return {
    summary: [head, ...rows.map((x) => `- ${line(x)}`), ...notes].join('\n'),
    year: r.year, make: r.make, model_query: a.model, trim_query: a.trim ?? null, matched_models: models,
    count: rows.length, vehicles: rows.map(pub), notes,
    as_of: now.toISOString(), source: SOURCE, more: more(),
  };
}

export interface VehicleSpec { year?: number; make?: string; model?: string; trim?: string; id?: number }

/** One vehicle for a spec: by id, or the best model match (exact name, then most attribute words in the name, then list order). */
export async function resolveOne(f: FetchText, s: VehicleSpec, now = new Date()): Promise<VehicleRow> {
  if (s.id !== undefined && s.id !== null) {
    const v = await record(f, s.id);
    return vehicleRow(v, undefined, await ympgFor(f, v));
  }
  if (!s.make || !s.model) throw new InputError('each vehicle needs make and model (and ideally year), or a fueleconomy.gov id');
  const q = parseQuery(s.model, s.trim);
  const r = await resolveModels(f, { year: s.year, make: s.make, model: s.model, trim: s.trim }, q, now);
  const want = q.base.join(' ');
  const score = (m: string) => {
    const t = tokens(m);
    const exact = t.join(' ') === want ? 100 : 0;
    const hits = q.attrs.filter((a) => (NAME_SYN[a] ?? [a]).some((w) => t.includes(w))).length;
    return exact + hits * 10;
  };
  const order = r.models.map((m, i) => ({ m, i, s: score(m) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 4);
  const tried: string[] = [];
  for (const { m } of order) {
    const opts = await optionsFor(f, r.year, r.make, m);
    for (const o of opts.slice(0, 3)) {
      if (!r.deferred.every((w) => hasTok([...tokens(m), ...tokens(o.text)], w))) continue;
      const v = await record(f, o.value);
      if (passes(v, o.text, m, q.attrs, [])) return vehicleRow(v, o.text, await ympgFor(f, v));
      tried.push(`${m} (${o.text}, ${kindOf(v)})`);
    }
  }
  throw new InputError(`no ${[...q.attrs.map((t) => ATTRS[t].label), ...r.deferred].join(', ')} version of the ${r.year} ${r.make} ${s.model} found. Tried: ${tried.join('; ') || order.map((o) => o.m).join('; ')}`);
}

export interface Prices { regular: number; midgrade: number; premium: number; diesel: number; e85: number; cng: number; lpg: number; electric: number }
export async function fuelPrices(f: FetchText): Promise<Prices> {
  const j = await getJson(f, 'fuelprices', 6 * 3600);
  const out: any = {};
  for (const k of ['regular', 'midgrade', 'premium', 'diesel', 'e85', 'cng', 'lpg', 'electric']) out[k] = num(j?.[k]);
  if (!out.regular || !out.electric) throw new UpstreamError('fueleconomy.gov fuel prices are missing');
  return out as Prices;
}

export interface CostResult {
  vehicle: string | null; powertrain: Kind | 'given MPG'; miles_per_year: number; city_percent: number;
  annual_cost: number; monthly_cost: number; cost_per_mile: number;
  gallons_per_year: number | null; kwh_per_year: number | null; price: Record<string, number>; efficiency_used: string;
  plug_in_hybrid: { gas_only_annual: number; electric_only_annual: number; utility_factor: number } | null;
  epa_annual_fuel_cost: number | null;
}

/** Fuel cost for a vehicle row at the given miles, city share and prices. At the EPA 55% city split the EPA combined figures are used. */
export function costOf(r: VehicleRow, miles: number, cityPct: number, prices: Prices, gasPrice?: number, kwhPrice?: number): CostResult {
  const v = r._raw;
  const c = cityPct / 100;
  const epaSplit = Math.abs(cityPct - 55) < 1e-9;
  const elecPrice = kwhPrice ?? prices.electric;
  const kwh100 = () => {
    if (epaSplit && pos(v.combE)) return { k: pos(v.combE) as number, how: 'EPA combined kWh/100 mi' };
    const ce = pos(v.cityE), he = pos(v.highwayE);
    if (ce && he) return { k: c * ce + (1 - c) * he, how: `${cityPct}% city kWh/100 mi from EPA city ${ce} and highway ${he}` };
    const k = pos(v.combE); if (!k) throw new UpstreamError('this vehicle has no kWh per 100 miles figure');
    return { k, how: 'EPA combined kWh/100 mi' };
  };
  const gasMpg = () => {
    if (epaSplit || !pos(v.city08) || !pos(v.highway08)) return { m: pos(v.comb08) as number, how: 'EPA combined MPG' };
    const m = 1 / (c / Number(v.city08) + (1 - c) / Number(v.highway08));
    return { m, how: `${cityPct}% city MPG ${Math.round(m * 10) / 10} from EPA city ${v.city08} and highway ${v.highway08}` };
  };
  const base = { vehicle: `${r.year} ${r.make} ${r.model} (${r.version})`, powertrain: r.powertrain, miles_per_year: miles, city_percent: cityPct, epa_annual_fuel_cost: r.annual_fuel_cost };
  if (r.powertrain === 'electric') {
    const k = kwh100();
    const kwh = (miles * k.k) / 100;
    const cost = kwh * elecPrice;
    return { ...base, annual_cost: r2(cost), monthly_cost: r2(cost / 12), cost_per_mile: Math.round((cost / miles) * 1000) / 1000, gallons_per_year: null, kwh_per_year: Math.round(kwh), price: { electric_per_kwh: elecPrice }, efficiency_used: k.how, plug_in_hybrid: null };
  }
  const key = priceKey(v.fuelType1);
  const gp = gasPrice ?? (key && key !== 'electric' ? (prices as any)[key] : null);
  if (!gp) throw new InputError(`fueleconomy.gov has no national price for ${v.fuelType1}; pass price_per_gallon (price per unit of that fuel)`);
  const g = gasMpg();
  const gallons = miles / g.m;
  const gasCost = gallons * gp;
  if (r.powertrain === 'plug-in hybrid' && pos(v.combinedUF) && pos(v.combE)) {
    const uf = pos(v.combinedUF) as number;
    const k = kwh100();
    const elecCost = ((miles * k.k) / 100) * elecPrice;
    const blended = uf * elecCost + (1 - uf) * gasCost;
    return {
      ...base, annual_cost: r2(blended), monthly_cost: r2(blended / 12), cost_per_mile: Math.round((blended / miles) * 1000) / 1000,
      gallons_per_year: Math.round(gallons * (1 - uf)), kwh_per_year: Math.round(((miles * k.k) / 100) * uf),
      price: { [`${key}_per_gallon`]: gp, electric_per_kwh: elecPrice }, efficiency_used: `${g.how} on gas, ${k.how} on electricity, EPA utility factor ${uf}`,
      plug_in_hybrid: { gas_only_annual: r2(gasCost), electric_only_annual: r2(elecCost), utility_factor: uf },
    };
  }
  return { ...base, annual_cost: r2(gasCost), monthly_cost: r2(gasCost / 12), cost_per_mile: Math.round((gasCost / miles) * 1000) / 1000, gallons_per_year: Math.round(gallons * 10) / 10, kwh_per_year: null, price: { [`${key}_per_gallon`]: gp }, efficiency_used: g.how, plug_in_hybrid: null };
}

export interface CostArgs {
  miles_per_year?: number; city_percent?: number; mpg?: number; kwh_per_100_miles?: number; fuel?: string;
  price_per_gallon?: number; electricity_price_per_kwh?: number; vehicle?: VehicleSpec;
}
const FUELS = ['regular', 'midgrade', 'premium', 'diesel', 'e85'];

export async function fuelCost(f: FetchText, a: CostArgs, now = new Date()) {
  const miles = a.miles_per_year ?? EPA_MILES;
  const city = a.city_percent ?? 55;
  if (!(miles > 0 && miles <= 200000)) throw new InputError('miles_per_year must be between 1 and 200,000');
  if (!(city >= 0 && city <= 100)) throw new InputError('city_percent must be 0 to 100');
  if (a.price_per_gallon !== undefined && !(a.price_per_gallon > 0 && a.price_per_gallon < 50)) throw new InputError('price_per_gallon must be between 0 and 50');
  if (a.electricity_price_per_kwh !== undefined && !(a.electricity_price_per_kwh > 0 && a.electricity_price_per_kwh < 5)) throw new InputError('electricity_price_per_kwh must be between 0 and 5');
  const prices = await fuelPrices(f);
  let res: CostResult;
  if (a.vehicle && (a.vehicle.id !== undefined || a.vehicle.model)) {
    const r = await resolveOne(f, a.vehicle, now);
    res = costOf(r, miles, city, prices, a.price_per_gallon, a.electricity_price_per_kwh);
  } else if (a.kwh_per_100_miles !== undefined) {
    if (!(a.kwh_per_100_miles > 5 && a.kwh_per_100_miles < 200)) throw new InputError('kwh_per_100_miles must be between 5 and 200');
    const p = a.electricity_price_per_kwh ?? prices.electric;
    const kwh = (miles * a.kwh_per_100_miles) / 100;
    const cost = kwh * p;
    res = { vehicle: null, powertrain: 'given MPG', miles_per_year: miles, city_percent: city, annual_cost: r2(cost), monthly_cost: r2(cost / 12), cost_per_mile: Math.round((cost / miles) * 1000) / 1000, gallons_per_year: null, kwh_per_year: Math.round(kwh), price: { electric_per_kwh: p }, efficiency_used: `${a.kwh_per_100_miles} kWh/100 mi (given)`, plug_in_hybrid: null, epa_annual_fuel_cost: null };
  } else if (a.mpg !== undefined) {
    if (!(a.mpg > 1 && a.mpg < 200)) throw new InputError('mpg must be between 1 and 200');
    const fuel = String(a.fuel ?? 'regular').toLowerCase();
    if (!FUELS.includes(fuel)) throw new InputError(`fuel must be one of ${FUELS.join(', ')}`);
    const p = a.price_per_gallon ?? (prices as any)[fuel];
    const gallons = miles / a.mpg;
    const cost = gallons * p;
    res = { vehicle: null, powertrain: 'given MPG', miles_per_year: miles, city_percent: city, annual_cost: r2(cost), monthly_cost: r2(cost / 12), cost_per_mile: Math.round((cost / miles) * 1000) / 1000, gallons_per_year: Math.round(gallons * 10) / 10, kwh_per_year: null, price: { [`${fuel}_per_gallon`]: p }, efficiency_used: `${a.mpg} MPG (given)`, plug_in_hybrid: null, epa_annual_fuel_cost: null };
  } else {
    throw new InputError('give mpg, kwh_per_100_miles, or a vehicle (make, model, year or id)');
  }
  const what = res.vehicle ?? res.efficiency_used;
  const priceTxt = Object.entries(res.price).map(([k, v]) => `${k.replace(/_per_/, ' per ').replace('electric', 'electricity')} ${usd2(v)}`).join(', ');
  let summary = `${what}: ${usd2(res.annual_cost)} a year (${usd2(res.monthly_cost)} a month, ${Math.round(res.cost_per_mile * 1000) / 10} cents a mile) for ${miles.toLocaleString('en-US')} miles at ${priceTxt}.`;
  if (res.plug_in_hybrid) summary += ` Plug-in hybrid: ${usd2(res.plug_in_hybrid.gas_only_annual)} on gas only, ${usd2(res.plug_in_hybrid.electric_only_annual)} on electricity only; the blend uses the EPA utility factor ${res.plug_in_hybrid.utility_factor} (share of miles on electricity).`;
  if (res.epa_annual_fuel_cost) summary += ` EPA estimate at 15,000 miles: ${usd(res.epa_annual_fuel_cost)} a year.`;
  return { summary, ...res, prices_national_average: prices, as_of: now.toISOString(), source: SOURCE, more: more() };
}

export async function compare(f: FetchText, a: { vehicles: VehicleSpec[]; miles_per_year?: number; city_percent?: number }, now = new Date()) {
  const list = a.vehicles ?? [];
  if (list.length < 2 || list.length > 4) throw new InputError('compare 2 to 4 vehicles');
  const miles = a.miles_per_year ?? EPA_MILES;
  const city = a.city_percent ?? 55;
  if (!(miles > 0 && miles <= 200000)) throw new InputError('miles_per_year must be between 1 and 200,000');
  if (!(city >= 0 && city <= 100)) throw new InputError('city_percent must be 0 to 100');
  const [prices, rows] = await Promise.all([fuelPrices(f), Promise.all(list.map((s) => resolveOne(f, s, now)))]);
  const items = rows.map((r) => ({ row: r, cost: costOf(r, miles, city, prices) }));
  const cheapest = items.reduce((a, b) => (b.cost.annual_cost < a.cost.annual_cost ? b : a));
  const out = items.map(({ row, cost }) => ({
    ...pub(row), annual_cost: cost.annual_cost, monthly_cost: cost.monthly_cost, cost_per_mile: cost.cost_per_mile,
    extra_per_year_vs_cheapest: r2(cost.annual_cost - cheapest.cost.annual_cost), extra_5_years_vs_cheapest: r2((cost.annual_cost - cheapest.cost.annual_cost) * 5),
    efficiency_used: cost.efficiency_used,
  }));
  const name = (r: VehicleRow) => `${r.year} ${r.make} ${r.model}`;
  const lines = items.map(({ row, cost }) => `- ${line(row)}. At ${miles.toLocaleString('en-US')} miles: ${usd(cost.annual_cost)} a year${row.id === cheapest.row.id ? ' (cheapest)' : `, ${usd(cost.annual_cost - cheapest.cost.annual_cost)} more than the ${name(cheapest.row)}`}`);
  const priceTxt = `regular ${usd2(prices.regular)}/gal, premium ${usd2(prices.premium)}/gal, diesel ${usd2(prices.diesel)}/gal, electricity ${usd2(prices.electric)}/kWh`;
  return {
    summary: [`Cheapest to fuel: ${name(cheapest.row)} at ${usd(cheapest.cost.annual_cost)} a year for ${miles.toLocaleString('en-US')} miles (${city}% city, national average ${priceTxt}).`, ...lines].join('\n'),
    miles_per_year: miles, city_percent: city, prices_national_average: prices, cheapest_id: cheapest.row.id, vehicles: out,
    as_of: now.toISOString(), source: SOURCE, more: more(),
  };
}

export async function modelsList(f: FetchText, a: { year?: number; make?: string; model?: string }, now = new Date()) {
  const year = a.year !== undefined ? checkYear(a.year, now) : (await years(f)).filter((y) => y <= now.getUTCFullYear() + 1)[0];
  const makes = await makesFor(f, year);
  if (!makes.length) throw new InputError(`fueleconomy.gov lists no vehicles for ${year}`);
  const base = { year, as_of: now.toISOString(), source: SOURCE, more: more() };
  if (!a.make) {
    return { summary: `${makes.length} makes have ${year} EPA fuel economy ratings: ${makes.join(', ')}.`, ...base, level: 'makes', count: makes.length, items: makes };
  }
  const make = matchMake(makes, a.make);
  if (!make) throw new InputError(`no make "${a.make}" in model year ${year}. Makes: ${makes.join(', ')}`);
  const all = await modelsFor(f, year, make);
  if (!a.model) {
    return { summary: `${all.length} ${year} ${make} models: ${all.join('; ')}.`, ...base, make, level: 'models', count: all.length, items: all };
  }
  const m = matchModels(all, parseQuery(a.model));
  if (!m.models.length) throw new InputError(`no ${year} ${make} model matches "${a.model}". Models: ${all.join('; ')}`);
  const models = m.models.slice(0, MAX_MODELS);
  const versions = (await Promise.all(models.map(async (mo) => (await optionsFor(f, year, make, mo)).map((o) => ({ model: mo, version: o.text, id: Number(o.value) }))))).flat();
  return {
    summary: `${versions.length} ${year} ${make} ${a.model} versions:\n${versions.map((v) => `- ${v.model}: ${v.version} (id ${v.id})`).join('\n')}${m.models.length > MAX_MODELS ? `\n(${m.models.length} models match; listed the first ${MAX_MODELS})` : ''}`,
    ...base, make, level: 'versions', count: versions.length, items: versions,
  };
}
