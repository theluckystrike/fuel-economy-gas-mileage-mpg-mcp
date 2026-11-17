// Fixtures in test/fixtures/ are fueleconomy.gov web service answers downloaded 2026-11-17 (Accept: application/json).
// File name = the decoded path after /ws/rest/ with runs of non-alphanumerics as '_'.
// Values read off those files: fuelprices regular 4.0, premium 5.01, diesel 6.13, electric 0.15. 2026 Toyota RAV4 versions
// 50285 (RAV4, 47/40/43 MPG, $1,400), 50134 and 50133 (AWD Limited & XSE, 41), 50135 (AWD SE & LE, 42), 50136 (AWD XLE, 41, My MPG 45.637629135 from 1
// driver), 50137 (Hybrid AWD Woodland Edition, 38, $1,600). 2026 Honda Accord Hybrid 50071 (48 combined) and Accord Hybrid Sport/Touring 50056
// (44, My MPG 45.385474771 from 2 drivers). 2025 Tesla Model Y Long Range AWD 48770: 117 MPGe, 28.7946 kWh/100 mi, 311 mi. 2026 Ford Escape FWD PHEV
// 49763: 40 MPG on gas, 101 MPGe, 33 kWh/100 mi, 37 mi electric range, utility factor 0.655. 2026 Ford F150 Pickup 2WD HEV 50447: 24 combined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  tokens, menuItems, matchMake, matchModels, parseQuery, parseYmpg, priceKey, lookup, compare, fuelCost, modelsList, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const dir = new URL('./fixtures/', import.meta.url);
const fx = (n) => readFileSync(new URL(n, dir), 'utf8');
const nameOf = (u) => decodeURIComponent(u.replace('https://www.fueleconomy.gov/ws/rest/', '')).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.json';
const seen = [];
const f = async (u, opts) => {
  seen.push(u);
  assert.equal(opts?.accept, 'application/json');
  if (/\/ympg\/shared\/ympgVehicle\//.test(u) && !existsSync(new URL(nameOf(u), dir))) return '';
  const n = nameOf(u);
  if (existsSync(new URL(n, dir))) return fx(n);
  throw new Error(`HTTP 404 (no fixture ${n})`);
};
const NOW = new Date('2026-11-17T15:00:00Z');

test('tokens, menus, make aliases and model matching', () => {
  assert.deepEqual(tokens('F-150 Hybrid'), ['f150', 'hybrid']);
  assert.deepEqual(tokens('RAV4 AWD Limited & XSE'), ['rav4', 'awd', 'limited', 'xse']);
  assert.deepEqual(menuItems({ menuItem: { text: 'a', value: '1' } }), [{ text: 'a', value: '1' }]);
  assert.deepEqual(menuItems(null), []);
  const makes = JSON.parse(fx('vehicle_menu_make_year_2026.json')).menuItem.map((m) => m.text);
  assert.equal(matchMake(makes, 'chevy'), 'Chevrolet'); assert.equal(matchMake(makes, 'VW'), 'Volkswagen');
  assert.equal(matchMake(makes, 'mercedes'), 'Mercedes-Benz'); assert.equal(matchMake(makes, 'toyota'), 'Toyota'); assert.equal(matchMake(makes, 'Yugo'), null);
  const toyota = JSON.parse(fx('vehicle_menu_model_year_2026_make_Toyota.json')).menuItem.map((m) => m.text);
  assert.deepEqual(matchModels(toyota, parseQuery('RAV4')).models, ['RAV4', 'RAV4 AWD Limited & XSE', 'RAV4 AWD SE & LE', 'RAV4 AWD XLE', 'RAV4 Hybrid AWD Woodland Edition']);
  assert.deepEqual(matchModels(toyota, parseQuery('RAV4', 'XLE')).models, ['RAV4 AWD XLE']);
  assert.deepEqual(parseQuery('Camry hybrid AWD'), { base: ['camry'], attrs: ['hybrid', 'awd'], extra: [] });
  assert.throws(() => parseQuery('hybrid'), InputError);
  assert.equal(parseYmpg(null), null); assert.equal(parseYmpg({ avgMpg: '45.637629135', recordCount: '1' }).average_mpg, 45.6);
  assert.equal(priceKey('Premium Gasoline'), 'premium'); assert.equal(priceKey('Regular Gasoline'), 'regular'); assert.equal(priceKey('Hydrogen'), null);
});

test('lookup 2026 Toyota RAV4: six hybrid versions, 38 to 43 combined MPG, My MPG on the XLE', async () => {
  const r = await lookup(f, { year: 2026, make: 'toyota', model: 'RAV4' }, NOW);
  assert.equal(r.count, 6);
  assert.deepEqual(r.vehicles.map((v) => v.id), [50285, 50134, 50133, 50135, 50136, 50137]);
  assert.deepEqual(r.vehicles[0].mpg, { city: 47, highway: 40, combined: 43 });
  assert.equal(r.vehicles[0].annual_fuel_cost, 1400); assert.equal(r.vehicles[0].powertrain, 'hybrid'); assert.equal(r.vehicles[0].co2_grams_per_mile, 205);
  assert.equal(r.vehicles[0].five_year_fuel_savings_vs_average_car, 3750); assert.equal(r.vehicles[0].my_mpg, null);
  assert.deepEqual(r.vehicles[4].my_mpg, { average_mpg: 45.6, drivers: 1, min_mpg: 46, max_mpg: 46, city_percent: 64 });
  assert.equal(r.vehicles[0]._raw, undefined);
  assert.match(r.summary, /^2026 Toyota RAV4: 6 versions, 38 to 43 combined MPG\./);
  assert.match(r.summary, /2026 Toyota RAV4 \(Auto \(AV-S6\), 4 cyl, 2\.5 L, hybrid\): 47 city \/ 40 hwy \/ 43 combined MPG, \$1,400 a year in fuel/);
  assert.ok(r.more.includes(UTM));
  assert.ok(!seen.some((u) => u.endsWith('/ympgVehicle/50285')), 'My MPG is read only when mpgData is Y');
  const x = await lookup(f, { year: 2026, make: 'Toyota', model: 'RAV4', trim: 'XLE' }, NOW);
  assert.deepEqual(x.vehicles.map((v) => v.id), [50136]);
});

test('lookup Accord hybrid keeps only hybrids; Model Y is electric with MPGe and range', async () => {
  const a = await lookup(f, { year: 2026, make: 'Honda', model: 'Accord', trim: 'hybrid' }, NOW);
  assert.deepEqual(a.vehicles.map((v) => [v.id, v.mpg.combined]), [[50071, 48], [50056, 44]]);
  assert.equal(a.vehicles[1].my_mpg.average_mpg, 45.4); assert.equal(a.vehicles[1].my_mpg.drivers, 2);
  const b = await lookup(f, { year: 2026, make: 'Honda', model: 'Accord Hybrid' }, NOW);
  assert.deepEqual(b.vehicles.map((v) => v.id), [50071, 50056]);
  const t = await lookup(f, { year: 2025, make: 'Tesla', model: 'Model Y' }, NOW);
  assert.deepEqual(t.vehicles.map((v) => v.id), [48770, 48771, 48772]);
  const y = t.vehicles[0];
  assert.equal(y.powertrain, 'electric'); assert.equal(y.mpg, null); assert.deepEqual(y.mpge, { city: 123, highway: 111, combined: 117 });
  assert.equal(y.range_miles, 311); assert.equal(y.kwh_per_100_miles, 28.7946); assert.equal(y.annual_fuel_cost, 650);
  assert.match(t.summary, /117 combined MPGe, 28\.8 kWh\/100 mi, 311 mi range/);
});

test('default year falls back when the newest year does not list the model', async () => {
  const f2 = async (u, o) => {
    if (u.endsWith('/vehicle/menu/year')) return '{"menuItem":[{"text":"2027","value":"2027"},{"text":"2026","value":"2026"},{"text":"2025","value":"2025"}]}';
    if (u.endsWith('/vehicle/menu/make?year=2027')) return fx('vehicle_menu_make_year_2026.json');
    if (u.endsWith('/vehicle/menu/model?year=2027&make=Toyota')) return '{"menuItem":{"text":"Camry HEV AWD LE","value":"Camry HEV AWD LE"}}';
    return f(u, o);
  };
  const r = await lookup(f2, { make: 'Toyota', model: 'RAV4', trim: 'XLE' }, NOW);
  assert.equal(r.year, 2026); assert.match(r.notes[0], /No Toyota RAV4 is listed for 2027 yet/);
});

test('compare RAV4, F-150 hybrid and Model Y at 15,000 miles and national prices', async () => {
  const r = await compare(f, { vehicles: [{ year: 2026, make: 'Toyota', model: 'RAV4' }, { year: 2026, make: 'Ford', model: 'F-150 hybrid' }, { year: 2025, make: 'Tesla', model: 'Model Y' }] }, NOW);
  assert.deepEqual(r.vehicles.map((v) => v.id), [50285, 50447, 48770]);
  assert.deepEqual(r.vehicles.map((v) => v.annual_cost), [1395.35, 2500, 647.88]);
  assert.equal(r.cheapest_id, 48770);
  assert.deepEqual(r.vehicles.map((v) => v.extra_per_year_vs_cheapest), [747.47, 1852.12, 0]);
  assert.equal(r.vehicles[1].extra_5_years_vs_cheapest, 9260.6);
  assert.match(r.summary, /^Cheapest to fuel: 2025 Tesla Model Y Long Range AWD at \$648 a year for 15,000 miles/);
  await assert.rejects(compare(f, { vehicles: [{ year: 2026, make: 'Toyota', model: 'RAV4' }] }, NOW), InputError);
});

test('fuel cost: from MPG, from a plug-in hybrid with the utility factor, from an id at 100% city, and from kWh/100 mi', async () => {
  const a = await fuelCost(f, { mpg: 30, miles_per_year: 12000 }, NOW);
  assert.match(a.summary, /^30 MPG \(given\): \$1,600\.00 a year \(\$133\.33 a month, 13\.3 cents a mile\) for 12,000 miles at regular \$4\.00\/gal\./);
  assert.equal(a.annual_cost, 1600); assert.equal(a.monthly_cost, 133.33); assert.equal(a.gallons_per_year, 400); assert.deepEqual(a.price, { regular_per_gallon: 4 });
  assert.equal((await fuelCost(f, { mpg: 30, miles_per_year: 12000, fuel: 'premium' }, NOW)).annual_cost, 2004);
  assert.equal((await fuelCost(f, { mpg: 30, miles_per_year: 12000, price_per_gallon: 3.5 }, NOW)).annual_cost, 1400);
  const p = await fuelCost(f, { vehicle: { year: 2026, make: 'Ford', model: 'Escape', trim: 'plug-in' } }, NOW);
  assert.match(p.vehicle, /Escape FWD PHEV/);
  assert.deepEqual(p.plug_in_hybrid, { gas_only_annual: 1500, electric_only_annual: 742.5, utility_factor: 0.655 });
  assert.equal(p.annual_cost, 1003.84); assert.equal(p.kwh_per_year, 3242); assert.equal(p.gallons_per_year, 129);
  const c = await fuelCost(f, { vehicle: { id: 50285 }, city_percent: 100 }, NOW);
  assert.equal(c.annual_cost, 1276.6); assert.equal(c.epa_annual_fuel_cost, 1400);
  const e = await fuelCost(f, { kwh_per_100_miles: 30, miles_per_year: 10000 }, NOW);
  assert.equal(e.annual_cost, 450); assert.equal(e.kwh_per_year, 3000);
  await assert.rejects(fuelCost(f, {}, NOW), InputError);
  await assert.rejects(fuelCost(f, { mpg: 30, fuel: 'rocket' }, NOW), InputError);
});

test('makes, models and versions', async () => {
  const m = await modelsList(f, { year: 2026 }, NOW);
  assert.equal(m.level, 'makes'); assert.equal(m.count, 46); assert.ok(m.items.includes('Tesla'));
  const t = await modelsList(f, { year: 2026, make: 'toyota' }, NOW);
  assert.equal(t.count, 76); assert.equal(t.make, 'Toyota');
  const v = await modelsList(f, { year: 2026, make: 'Toyota', model: 'RAV4' }, NOW);
  assert.equal(v.level, 'versions'); assert.deepEqual(v.items.map((i) => i.id), [50285, 50134, 50133, 50135, 50136, 50137]);
});

test('input errors and upstream errors', async () => {
  await assert.rejects(lookup(f, { year: 2026, make: 'Yugo', model: 'GV' }, NOW), InputError);
  await assert.rejects(lookup(f, { year: 2026, make: 'Toyota', model: 'Zzzz' }, NOW), InputError);
  await assert.rejects(lookup(f, { year: 1980, make: 'Toyota', model: 'Corolla' }, NOW), InputError);
  await assert.rejects(lookup(f, { year: 2026, make: 'Toyota', model: 'RAV4', trim: 'diesel' }, NOW), /no diesel version of the 2026 Toyota RAV4/);
  await assert.rejects(fuelCost(f, { vehicle: { id: 9999999 } }, NOW), InputError);
  await assert.rejects(fuelCost(async () => '<html>', { mpg: 30 }, NOW), UpstreamError);
  await assert.rejects(modelsList(async () => { throw new Error('HTTP 503'); }, { year: 2026 }, NOW), UpstreamError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'fuel-economy-gas-mileage-mpg-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['fuel_economy_lookup', 'fuel_economy_compare', 'fuel_cost_calculator', 'fuel_economy_models']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'fuel_cost_calculator', arguments: { mpg: 30, fuel: 'rocket' } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
