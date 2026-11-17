// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, compare, fuelCost, lookup, modelsList } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'fuel-economy-mpg',
  metaDescription: 'MCP server for fuel economy and gas mileage: EPA city, highway and combined MPG, MPGe and EV range, annual fuel cost and real-world MPG for any car, truck, hybrid or EV by year, make and model, plus side-by-side comparisons and a fuel cost calculator.',
  intro: 'EPA fuel economy (MPG, MPGe, EV range, annual fuel cost) for any car by year, make and model, read live from fueleconomy.gov.',
};

export const TOOL_INFO = [
  { name: 'fuel_economy_lookup', blurb: 'EPA city, highway and combined MPG (or MPGe and range for an EV) for every version of a year, make and model, with annual fuel cost, CO2 and driver-reported MPG.' },
  { name: 'fuel_economy_compare', blurb: '2 to 4 vehicles side by side: MPG or MPGe, range and the yearly and 5-year fuel cost difference at current national prices.' },
  { name: 'fuel_cost_calculator', blurb: 'Yearly and monthly fuel cost for your miles, from an MPG figure, a kWh/100 mi figure or a vehicle, at current national average prices or your own.' },
  { name: 'fuel_economy_models', blurb: 'Makes with EPA ratings for a model year, models for a make, or every version (engine, transmission) of a model with its fueleconomy.gov id.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream fueleconomy.gov error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };

const year = z.number().int().min(1984).max(2100).optional().describe('Model year, e.g. 2026. Default: the newest model year that lists this vehicle.');
const make = z.string().min(1).max(40).describe('Manufacturer, e.g. Toyota, Ford, Tesla, Chevrolet (Chevy and VW work too).');
const model = z.string().min(1).max(60).describe('Model name as people say it, e.g. "RAV4", "F-150", "Model Y", "Camry hybrid", "CR-V AWD".');
const trim = z.string().max(60).optional().describe('Optional words to narrow it: hybrid, plug-in, AWD, 4WD, FWD, diesel, a trim (XLE, Limited) or an engine (2.7, turbo).');
const vehicleSpec = z.object({
  year: z.number().int().min(1984).max(2100).optional().describe('Model year.'),
  make: z.string().max(40).optional().describe('Manufacturer.'),
  model: z.string().max(60).optional().describe('Model, e.g. "RAV4 hybrid".'),
  trim: z.string().max(60).optional().describe('Optional narrowing words.'),
  id: z.number().int().positive().optional().describe('fueleconomy.gov vehicle id instead of make and model (from fuel_economy_models).'),
});

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'EPA fuel economy for US cars, trucks, hybrids and EVs from the U.S. Department of Energy and EPA (fueleconomy.gov), read at call time. ' +
      'A model cannot reliably recall the MPG of a specific version, the EV range or what it costs to fuel at today\'s prices. ' +
      'Use fuel_economy_lookup for "what MPG does a 2026 RAV4 get", fuel_economy_compare for "which is cheaper to run", fuel_cost_calculator for ' +
      '"how much will I spend on gas a month", and fuel_economy_models to list makes, models or versions. Words like hybrid, AWD or a trim narrow a match.',
  });

  server.registerTool('fuel_economy_lookup', {
    title: 'Fuel economy and MPG lookup',
    description:
      'EPA fuel economy for every version of a vehicle by year, make and model: city, highway and combined MPG (MPGe, kWh per 100 miles and range for an EV; ' +
      'gas MPG, electric MPGe and electric range for a plug-in hybrid), EPA annual fuel cost, 5-year savings against the average new car, tailpipe CO2, ' +
      'EPA fuel economy and greenhouse gas scores, and the average MPG real drivers report on fueleconomy.gov when there is one.',
    inputSchema: { year, make, model, trim },
    annotations: { title: 'Fuel economy lookup', ...RO },
  }, wrap((a: any) => lookup(fetchText, a)));

  server.registerTool('fuel_economy_compare', {
    title: 'Compare fuel economy',
    description:
      'Compare 2 to 4 vehicles side by side: MPG or MPGe, range, and the yearly fuel cost at current national average prices for your miles, with how much more ' +
      'each costs per year and over 5 years than the cheapest. Each vehicle is a year, make and model (best match) or a fueleconomy.gov id.',
    inputSchema: {
      vehicles: z.array(vehicleSpec).min(2).max(4).describe('2 to 4 vehicles, e.g. [{"year":2026,"make":"Toyota","model":"RAV4"},{"year":2025,"make":"Tesla","model":"Model Y"}].'),
      miles_per_year: z.number().positive().max(200000).optional().describe('Miles driven a year. Default 15,000 (the EPA assumption).'),
      city_percent: z.number().min(0).max(100).optional().describe('Share of city driving in percent. Default 55 (the EPA assumption).'),
    },
    annotations: { title: 'Compare fuel economy', ...RO },
  }, wrap((a: any) => compare(fetchText, a)));

  server.registerTool('fuel_cost_calculator', {
    title: 'Fuel cost calculator',
    description:
      'Yearly and monthly fuel cost and cost per mile for your driving, from an MPG figure, a kWh per 100 miles figure (EV) or a vehicle (year, make, model or id), ' +
      'at the national average gas, diesel and electricity prices fueleconomy.gov uses, or at your own price. Plug-in hybrids get gas-only, electric-only and ' +
      'an EPA utility-factor blend.',
    inputSchema: {
      miles_per_year: z.number().positive().max(200000).optional().describe('Miles a year. Default 15,000.'),
      city_percent: z.number().min(0).max(100).optional().describe('Share of city driving in percent. Default 55.'),
      mpg: z.number().positive().max(200).optional().describe('Miles per gallon, if you are not naming a vehicle.'),
      kwh_per_100_miles: z.number().positive().max(200).optional().describe('EV consumption in kWh per 100 miles, if you are not naming a vehicle.'),
      fuel: z.enum(['regular', 'midgrade', 'premium', 'diesel', 'e85']).optional().describe('Fuel for an mpg figure. Default regular.'),
      price_per_gallon: z.number().positive().max(50).optional().describe('Your own fuel price per gallon instead of the national average.'),
      electricity_price_per_kwh: z.number().positive().max(5).optional().describe('Your own electricity price per kWh instead of the national average.'),
      vehicle: vehicleSpec.optional().describe('A vehicle instead of an mpg figure.'),
    },
    annotations: { title: 'Fuel cost calculator', ...RO },
  }, wrap((a: any) => fuelCost(fetchText, a)));

  server.registerTool('fuel_economy_models', {
    title: 'Makes, models and versions',
    description:
      'What fueleconomy.gov lists for a model year: with no make, every make with EPA ratings; with a make, every model; with a make and model, every version ' +
      '(transmission, cylinders, engine size) with its fueleconomy.gov id for exact lookups and comparisons. Years 1984 to next year.',
    inputSchema: {
      year: z.number().int().min(1984).max(2100).optional().describe('Model year. Default the newest listed.'),
      make: z.string().max(40).optional().describe('Manufacturer, to list its models.'),
      model: z.string().max(60).optional().describe('Model, to list its versions and ids.'),
    },
    annotations: { title: 'Makes, models and versions', ...RO },
  }, wrap((a: any) => modelsList(fetchText, a)));

  return server;
}
