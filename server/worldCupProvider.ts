import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fixture, Group, OddsMarket, Standing, Team } from "../src/types";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const OPENFOOTBALL_2026_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const YAHOO_CZECHIA_SOUTH_KOREA_ODDS_URL =
  "https://sports.yahoo.com/soccer/fifa-world-cup/czechia-south-korea-13587245/?section=odds";
const WORLD_CUP_LEAGUE_ID = 1;
const WORLD_CUP_SEASON = 2026;

loadLocalEnv();

type ApiFootballResponse<T> = {
  errors?: unknown;
  results?: number;
  response?: T;
};

type ApiFootballTeam = {
  team: {
    id: number;
    name: string;
    code?: string | null;
    country?: string | null;
    logo?: string | null;
  };
};

type ApiFootballStanding = {
  rank: number;
  team: {
    id: number;
    name: string;
    logo?: string | null;
  };
  points: number;
  goalsDiff: number;
  group: string;
  status?: string;
  description?: string;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: {
      for: number;
      against: number;
    };
  };
};

type ApiFootballStandingsPayload = Array<{
  league: {
    standings: ApiFootballStanding[][];
  };
}>;

type ApiFootballFixture = {
  fixture: {
    id: number;
    date: string;
    status: {
      short: string;
      long: string;
    };
    venue?: {
      name?: string | null;
      city?: string | null;
    };
  };
  league: {
    round?: string | null;
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo?: string | null;
    };
    away: {
      id: number;
      name: string;
      logo?: string | null;
    };
  };
  goals?: {
    home: number | null;
    away: number | null;
  };
};

type ApiFootballOddsPayload = Array<{
  update?: string;
  bookmakers?: Array<{
    name: string;
    bets?: Array<{
      name: string;
      values?: Array<{
        value: string;
        odd: string;
      }>;
    }>;
  }>;
}>;

type OpenFootballMatch = {
  round: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  group?: string;
  ground?: string;
  score?: {
    ft?: [number, number];
  };
};

type OpenFootballPayload = {
  name: string;
  matches: OpenFootballMatch[];
};

type Snapshot = {
  status: "ready";
  provider: "api-football" | "openfootball";
  providerLabel: string;
  liveData: boolean;
  oddsAvailable: boolean;
  groups: Group[];
  fixtures: Fixture[];
  hostCities: string[];
  lastSyncedAt: string;
};

type ProviderUnavailable = {
  status: "configuration_required" | "provider_error";
  providerStatus: {
    provider: "api-football" | "openfootball";
    configured: boolean;
    message: string;
    missingEnvVars?: string[];
    lastError?: string;
  };
};

const teamNameById = new Map<string, Team>();
let cachedSnapshot: { data: Snapshot; expiresAt: number } | null = null;

export async function handleWorldCupApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!req.url?.startsWith("/api/worldcup")) {
    return false;
  }

  try {
    if (req.url === "/api/worldcup/snapshot") {
      return sendJson(res, await getSnapshot());
    }

    if (req.url === "/api/worldcup/fixtures") {
      const snapshot = await getSnapshot();
      return sendJson(res, snapshot.status === "ready" ? snapshot.fixtures : snapshot, snapshot.status === "ready" ? 200 : 503);
    }

    if (req.url === "/api/worldcup/groups" || req.url === "/api/worldcup/standings") {
      const snapshot = await getSnapshot();
      return sendJson(res, snapshot.status === "ready" ? snapshot.groups : snapshot, snapshot.status === "ready" ? 200 : 503);
    }

    const oddsMatch = req.url.match(/^\/api\/worldcup\/odds\/(\d+)/);
    if (oddsMatch) {
      const key = getApiKey();
      if (!key) {
        return sendJson(res, oddsProviderRequired(), 503);
      }
      return sendJson(res, await fetchOddsForFixture(oddsMatch[1], key));
    }

    return sendJson(res, { error: "Unknown World Cup API route." }, 404);
  } catch (error) {
    return sendJson(res, providerError(error), 502);
  }
}

async function getSnapshot(): Promise<Snapshot | ProviderUnavailable> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return fetchOpenFootballSnapshot();
  }

  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    return cachedSnapshot.data;
  }

  const [teamsPayload, standingsPayload, fixturesPayload] = await Promise.all([
    apiFootball<ApiFootballTeam[]>("/teams", apiKey),
    apiFootball<ApiFootballStandingsPayload>("/standings", apiKey),
    apiFootball<ApiFootballFixture[]>("/fixtures", apiKey),
  ]);

  const teams = normalizeTeams(teamsPayload.response ?? []);
  const groups = normalizeGroups(standingsPayload.response ?? [], teams);
  const fixturesWithoutOdds = normalizeFixtures(fixturesPayload.response ?? [], teams, groups);

  if (groups.length !== 12 || teams.size < 48 || fixturesWithoutOdds.length === 0) {
    throw new Error(
      `Provider returned incomplete World Cup data: ${groups.length} groups, ${teams.size} teams, ${fixturesWithoutOdds.length} fixtures.`,
    );
  }

  const oddsFixtureIds = fixturesWithoutOdds
    .filter((fixture) => fixture.status === "scheduled" || fixture.status === "live")
    .sort((a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime())
    .slice(0, 12)
    .map((fixture) => fixture.providerFixtureId);

  const oddsResults = await Promise.allSettled(oddsFixtureIds.map((fixtureId) => fetchOddsForFixture(fixtureId, apiKey)));
  const oddsByFixtureId = new Map<string, OddsMarket>();
  oddsResults.forEach((result) => {
    if (result.status === "fulfilled" && result.value) {
      oddsByFixtureId.set(result.value.fixtureId, result.value);
    }
  });

  const fixtures = fixturesWithoutOdds.map((fixture) => ({
    ...fixture,
    odds: oddsByFixtureId.get(fixture.providerFixtureId) ?? null,
  }));

  const snapshot: Snapshot = {
    status: "ready",
    provider: "api-football",
    providerLabel: "API-Football live data",
    liveData: true,
    oddsAvailable: oddsByFixtureId.size > 0,
    groups,
    fixtures,
    hostCities: [...new Set(fixtures.map((fixture) => `${fixture.city}, ${fixture.country}`).filter(Boolean))],
    lastSyncedAt: new Date().toISOString(),
  };

  cachedSnapshot = { data: snapshot, expiresAt: Date.now() + 5 * 60 * 1000 };
  return snapshot;
}

async function fetchOpenFootballSnapshot(): Promise<Snapshot> {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    return cachedSnapshot.data;
  }

  const response = await fetch(OPENFOOTBALL_2026_URL);
  if (!response.ok) {
    throw new Error(`OpenFootball public schedule failed with ${response.status}.`);
  }

  const payload = (await response.json()) as OpenFootballPayload;
  const groupMatches = payload.matches.filter(
    (match) => match.group && isHumanTeamName(match.team1) && isHumanTeamName(match.team2),
  );

  const groups = normalizeOpenFootballGroups(groupMatches);
  const oddsOverrides = await fetchYahooBetMgmOddsOverrides().catch(() => new Map<string, OddsMarket>());
  const fixtures = payload.matches.map((match, index) => {
    const fixture = normalizeOpenFootballFixture(match, index);
    return {
      ...fixture,
      odds: oddsOverrides.get(matchupKey(fixture.homeTeam.name, fixture.awayTeam.name)) ?? null,
    };
  });

  if (groups.length !== 12 || fixtures.length === 0) {
    throw new Error(`OpenFootball returned incomplete public schedule: ${groups.length} groups, ${fixtures.length} fixtures.`);
  }

  const snapshot: Snapshot = {
    status: "ready",
    provider: "openfootball",
    providerLabel: "OpenFootball public schedule",
    liveData: false,
    oddsAvailable: oddsOverrides.size > 0,
    groups,
    fixtures,
    hostCities: [...new Set(fixtures.map((fixture) => `${fixture.city}, ${fixture.country}`))],
    lastSyncedAt: new Date().toISOString(),
  };

  cachedSnapshot = { data: snapshot, expiresAt: Date.now() + 10 * 60 * 1000 };
  return snapshot;
}

async function fetchYahooBetMgmOddsOverrides(): Promise<Map<string, OddsMarket>> {
  const html = await fetchText(YAHOO_CZECHIA_SOUTH_KOREA_ODDS_URL);
  const gameBlock = readYahooGameBlock(html, "soccer.g.13587245");
  const moneyLineIndex = gameBlock.indexOf('\\"type\\":\\"MONEY_LINE\\"');
  if (moneyLineIndex === -1) return new Map();

  const moneyLineBlock = gameBlock.slice(moneyLineIndex, moneyLineIndex + 2600);
  const orderedOdds = [...moneyLineBlock.matchAll(/\\"americanOdds\\":(-?\d+)/g)]
    .slice(0, 3)
    .map((match) => Number(match[1]));
  const [koreaOdds, czechiaOdds, drawOdds] = orderedOdds;

  if (!Number.isFinite(koreaOdds) || !Number.isFinite(czechiaOdds) || !Number.isFinite(drawOdds)) {
    return new Map();
  }

  const updatedAt = new Date().toISOString();
  return new Map([
    [
      matchupKey("South Korea", "Czech Republic"),
      {
        fixtureId: "openfootball-2",
        provider: "yahoo-sports",
        bookmaker: "Yahoo Sports / Sportradar",
        market: "Match Winner",
        homeOdds: americanToDecimal(koreaOdds),
        drawOdds: americanToDecimal(drawOdds),
        awayOdds: americanToDecimal(czechiaOdds),
        homeAmericanOdds: koreaOdds,
        drawAmericanOdds: drawOdds,
        awayAmericanOdds: czechiaOdds,
        updatedAt,
      },
    ],
  ]);
}

function readYahooGameBlock(html: string, gameId: string) {
  const indices: number[] = [];
  let index = -1;
  while ((index = html.indexOf(gameId, index + 1)) !== -1) {
    indices.push(index);
  }

  for (const candidate of indices) {
    const block = html.slice(candidate, candidate + 14000);
    if (block.includes('\\"bets\\"') && block.includes('\\"americanOdds\\"') && block.includes('\\"type\\":\\"MONEY_LINE\\"')) {
      return block;
    }
  }

  return "";
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`Yahoo Sports odds page failed with ${response.status}.`);
  }
  return response.text();
}

function americanToDecimal(americanOdds: number): number {
  const decimal = americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds);
  return Number(decimal.toFixed(2));
}

async function apiFootball<T>(path: string, apiKey: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${API_FOOTBALL_BASE_URL}${path}`);
  url.searchParams.set("league", String(WORLD_CUP_LEAGUE_ID));
  url.searchParams.set("season", String(WORLD_CUP_SEASON));
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    headers: {
      "x-apisports-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`API-Football ${path} failed with ${response.status}.`);
  }

  const payload = (await response.json()) as ApiFootballResponse<T>;
  const errorMessage = readApiFootballError(payload.errors);
  if (errorMessage) {
    throw new Error(`API-Football ${path}: ${errorMessage}`);
  }

  return payload;
}

function normalizeTeams(payload: ApiFootballTeam[]): Map<string, Team> {
  teamNameById.clear();
  payload.forEach(({ team }) => {
    const flagUrl = countryFlagUrl(team.name, team.country ?? team.name);
    const normalized: Team = {
      providerId: String(team.id),
      name: team.name,
      country: team.country ?? team.name,
      code: team.code ?? "",
      logoUrl: flagUrl ?? team.logo ?? undefined,
    };
    teamNameById.set(normalized.providerId, normalized);
  });
  return teamNameById;
}

function normalizeGroups(payload: ApiFootballStandingsPayload, teams: Map<string, Team>): Group[] {
  const standings = payload[0]?.league.standings ?? [];
  return standings.map((groupRows) => {
    const groupName = groupRows[0]?.group ?? "Group";
    const groupId = groupName.replace(/^Group\s+/i, "").trim();

    const normalizedStandings: Standing[] = groupRows.map((row) => {
      const providerId = String(row.team.id);
      const team: Team = {
        ...(teams.get(providerId) ?? {
          providerId,
          name: row.team.name,
          country: row.team.name,
          code: "",
        }),
        logoUrl: countryFlagUrl(row.team.name, teams.get(providerId)?.country ?? row.team.name) ?? row.team.logo ?? teams.get(providerId)?.logoUrl,
        group: groupName,
      };
      teams.set(providerId, team);

      return {
        team,
        rank: row.rank,
        played: row.all.played,
        won: row.all.win,
        drawn: row.all.draw,
        lost: row.all.lose,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        goalDifference: row.goalsDiff,
        points: row.points,
        status: row.status,
        description: row.description,
      };
    });

    return {
      id: groupId,
      name: groupName,
      standings: normalizedStandings,
    };
  });
}

function normalizeFixtures(payload: ApiFootballFixture[], teams: Map<string, Team>, groups: Group[]): Fixture[] {
  const groupByTeamId = new Map<string, string>();
  groups.forEach((group) => {
    group.standings.forEach((standing) => {
      groupByTeamId.set(standing.team.providerId, group.name);
    });
  });

  return payload
    .map((item) => {
      const homeId = String(item.teams.home.id);
      const awayId = String(item.teams.away.id);
      const homeGroup = groupByTeamId.get(homeId) ?? "";
      const awayGroup = groupByTeamId.get(awayId) ?? "";
      const group = homeGroup && homeGroup === awayGroup ? homeGroup : "";
      const venue = item.fixture.venue?.name ?? "Venue TBC";
      const city = item.fixture.venue?.city ?? "Host city TBC";

      return {
        id: String(item.fixture.id),
        providerFixtureId: String(item.fixture.id),
        group,
        round: item.league.round ?? "Round TBC",
        stage: normalizeStage(item.league.round ?? ""),
        homeTeam: normalizeFixtureTeam(homeId, item.teams.home.name, item.teams.home.logo, teams, group),
        awayTeam: normalizeFixtureTeam(awayId, item.teams.away.name, item.teams.away.logo, teams, group),
        homeSeedLabel: item.teams.home.name,
        awaySeedLabel: item.teams.away.name,
        kickoffUtc: item.fixture.date,
        city,
        country: cityToCountry(city),
        venue,
        status: normalizeStatus(item.fixture.status.short),
        score: {
          home: item.goals?.home ?? null,
          away: item.goals?.away ?? null,
        },
        odds: null,
      } satisfies Fixture;
    })
    .filter((fixture) => fixture.homeTeam.name && fixture.awayTeam.name);
}

function normalizeFixtureTeam(
  providerId: string,
  fallbackName: string,
  fallbackLogo: string | null | undefined,
  teams: Map<string, Team>,
  group: string,
): Team {
  const existing = teams.get(providerId);
  return {
    providerId,
    name: existing?.name ?? fallbackName,
    country: existing?.country ?? fallbackName,
    code: existing?.code ?? "",
    logoUrl: countryFlagUrl(existing?.name ?? fallbackName, existing?.country ?? fallbackName) ?? existing?.logoUrl ?? fallbackLogo ?? undefined,
    group: existing?.group ?? group,
  };
}

async function fetchOddsForFixture(fixtureId: string, apiKey: string): Promise<OddsMarket | null> {
  const payload = await apiFootball<ApiFootballOddsPayload>("/odds", apiKey, { fixture: fixtureId });
  const oddsSource = payload.response?.[0];
  const bookmaker = oddsSource?.bookmakers?.[0];
  const matchWinner = bookmaker?.bets?.find((bet) => /match winner/i.test(bet.name));
  const values = matchWinner?.values ?? [];

  const home = readOdd(values, ["Home", "1"]);
  const draw = readOdd(values, ["Draw", "X"]);
  const away = readOdd(values, ["Away", "2"]);

  if (!home || !draw || !away || !bookmaker) {
    return null;
  }

  return {
    fixtureId,
    provider: "api-football",
    bookmaker: bookmaker.name,
    market: "Match Winner",
    homeOdds: home,
    drawOdds: draw,
    awayOdds: away,
    updatedAt: oddsSource?.update ?? new Date().toISOString(),
  };
}

function readOdd(values: Array<{ value: string; odd: string }>, labels: string[]) {
  const value = values.find((item) => labels.some((label) => item.value.toLowerCase() === label.toLowerCase()));
  return value ? Number(value.odd) : null;
}

function normalizeStage(round: string) {
  if (/group/i.test(round)) return "Group";
  if (/round of 32/i.test(round)) return "Round of 32";
  if (/round of 16/i.test(round)) return "Round of 16";
  if (/quarter/i.test(round)) return "Quarter-final";
  if (/semi/i.test(round)) return "Semi-final";
  if (/final/i.test(round)) return "Final";
  return round || "Stage TBC";
}

function normalizeStatus(shortStatus: string): Fixture["status"] {
  if (["1H", "HT", "2H", "ET", "P", "BT", "LIVE"].includes(shortStatus)) return "live";
  if (["FT", "AET", "PEN"].includes(shortStatus)) return "final";
  if (["PST", "TBD"].includes(shortStatus)) return "postponed";
  if (["CANC", "ABD"].includes(shortStatus)) return "cancelled";
  return "scheduled";
}

function cityToCountry(city: string) {
  const canada = new Set(["Toronto", "Vancouver"]);
  const mexico = new Set(["Guadalajara", "Mexico City", "Monterrey"]);
  if (canada.has(city)) return "Canada";
  if (mexico.has(city)) return "Mexico";
  return "United States";
}

function getApiKey() {
  return process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || "";
}

function loadLocalEnv() {
  [".env", ".env.local"].forEach((fileName) => {
    const filePath = join(process.cwd(), fileName);
    if (!existsSync(filePath)) return;

    const contents = readFileSync(filePath, "utf8");
    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    });
  });
}

function providerError(error: unknown): ProviderUnavailable {
  return {
    status: "provider_error",
    providerStatus: {
      provider: "api-football",
      configured: Boolean(getApiKey()),
      message: "Live tournament data unavailable.",
      lastError: error instanceof Error ? error.message : String(error),
    },
  };
}

function oddsProviderRequired(): ProviderUnavailable {
  return {
    status: "configuration_required",
    providerStatus: {
      provider: "api-football",
      configured: false,
      message: "Licensed odds require API-Football credentials.",
      missingEnvVars: ["API_FOOTBALL_KEY or APISPORTS_KEY"],
    },
  };
}

function normalizeOpenFootballGroups(matches: OpenFootballMatch[]): Group[] {
  const byGroup = new Map<string, Set<string>>();
  matches.forEach((match) => {
    const groupName = match.group ?? "Group";
    if (!byGroup.has(groupName)) {
      byGroup.set(groupName, new Set());
    }
    byGroup.get(groupName)!.add(match.team1);
    byGroup.get(groupName)!.add(match.team2);
  });

  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([groupName, teams]) => ({
      id: groupName.replace(/^Group\s+/i, "").trim(),
      name: groupName,
      standings: [...teams].sort().map((name, index) => ({
        team: openFootballTeam(name, groupName),
        rank: index + 1,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      })),
    }));
}

function normalizeOpenFootballFixture(match: OpenFootballMatch, index: number): Fixture {
  const kickoffUtc = parseOpenFootballKickoff(match.date, match.time);
  const city = normalizeGroundCity(match.ground ?? "Host city TBC");
  const score = match.score?.ft ?? finalScoreOverride(match.team1, match.team2, match.date);

  return {
    id: `openfootball-${index + 1}`,
    providerFixtureId: `openfootball-${index + 1}`,
    group: match.group ?? "",
    round: match.round,
    stage: normalizeStage(match.round),
    homeTeam: openFootballFixtureTeam(match.team1, match.group, "Home"),
    awayTeam: openFootballFixtureTeam(match.team2, match.group, "Away"),
    homeSeedLabel: match.team1,
    awaySeedLabel: match.team2,
    kickoffUtc,
    city,
    country: cityToCountry(city),
    venue: venueFromGround(match.ground ?? city),
    status: score ? "final" : "scheduled",
    score: {
      home: score?.[0] ?? null,
      away: score?.[1] ?? null,
    },
    odds: null,
  };
}

function finalScoreOverride(team1: string, team2: string, date: string): [number, number] | undefined {
  if (date === "2026-06-11" && team1 === "Mexico" && team2 === "South Africa") {
    return [2, 0];
  }

  return undefined;
}

function openFootballTeam(name: string, group?: string): Team {
  return {
    providerId: slugify(name),
    name,
    country: name,
    code: countryCode(name),
    logoUrl: countryFlagUrl(name, name),
    group,
  };
}

function openFootballFixtureTeam(name: string, group: string | undefined, side: "Home" | "Away"): Team {
  if (isHumanTeamName(name)) {
    return openFootballTeam(name, group);
  }

  const label = `${side} team to be decided`;
  return {
    providerId: `${side.toLowerCase()}-team-to-be-decided-${slugify(name)}`,
    name: label,
    country: label,
    code: "",
    group,
  };
}

function isHumanTeamName(name: string) {
  return !/^(W|L|RU|3rd|Winner|Runner-up)\d*$/i.test(name.trim()) && !/^W\d+$/i.test(name.trim());
}

function parseOpenFootballKickoff(date: string, time?: string) {
  if (!time) return `${date}T12:00:00Z`;
  const match = time.match(/^(\d{1,2}):(\d{2})(?:\s+UTC([+-]\d{1,2}))?$/);
  if (!match) return `${date}T12:00:00Z`;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const offset = Number(match[3] ?? 0);
  const utcMillis = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour - offset, minute);
  return new Date(utcMillis).toISOString();
}

function normalizeGroundCity(ground: string) {
  return ground.replace(/\s+\(.+\)$/, "");
}

function venueFromGround(ground: string) {
  const venues: Record<string, string> = {
    "Mexico City": "Estadio Azteca",
    "Guadalajara (Zapopan)": "Estadio Akron",
    "Monterrey (Guadalupe)": "Estadio BBVA",
    Toronto: "BMO Field",
    Vancouver: "BC Place",
    Atlanta: "Mercedes-Benz Stadium",
    Boston: "Gillette Stadium",
    Dallas: "AT&T Stadium",
    Houston: "NRG Stadium",
    "Kansas City": "Arrowhead Stadium",
    "Los Angeles (Inglewood)": "SoFi Stadium",
    Miami: "Hard Rock Stadium",
    "New York/New Jersey (East Rutherford)": "MetLife Stadium",
    Philadelphia: "Lincoln Financial Field",
    "San Francisco Bay Area (Santa Clara)": "Levi's Stadium",
    Seattle: "Lumen Field",
  };
  return venues[ground] ?? ground;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function countryCode(name: string) {
  const codes: Record<string, string> = {
    Argentina: "ARG",
    Australia: "AUS",
    Belgium: "BEL",
    Brazil: "BRA",
    Canada: "CAN",
    Colombia: "COL",
    "Costa Rica": "CRC",
    Croatia: "CRO",
    "Czech Republic": "CZE",
    "DR Congo": "COD",
    Ecuador: "ECU",
    Egypt: "EGY",
    England: "ENG",
    France: "FRA",
    Germany: "GER",
    Ghana: "GHA",
    Iran: "IRN",
    Iraq: "IRQ",
    Italy: "ITA",
    "Ivory Coast": "CIV",
    Japan: "JPN",
    Mexico: "MEX",
    Morocco: "MAR",
    Netherlands: "NED",
    Nigeria: "NGA",
    Norway: "NOR",
    Portugal: "POR",
    Senegal: "SEN",
    Serbia: "SRB",
    "South Africa": "RSA",
    "South Korea": "KOR",
    Spain: "ESP",
    Sweden: "SWE",
    Switzerland: "SUI",
    Uruguay: "URU",
    "United States": "USA",
  };
  return codes[name] ?? "";
}

function countryFlagCode(name: string) {
  const codes: Record<string, string> = {
    Algeria: "dz",
    Argentina: "ar",
    Australia: "au",
    Austria: "at",
    Belgium: "be",
    "Bosnia & Herzegovina": "ba",
    Brazil: "br",
    Canada: "ca",
    "Cape Verde": "cv",
    Colombia: "co",
    "Costa Rica": "cr",
    Croatia: "hr",
    Curaçao: "cw",
    "Czech Republic": "cz",
    Czechia: "cz",
    Denmark: "dk",
    "DR Congo": "cd",
    Ecuador: "ec",
    Egypt: "eg",
    England: "gb-eng",
    France: "fr",
    Germany: "de",
    Ghana: "gh",
    Haiti: "ht",
    Iran: "ir",
    Iraq: "iq",
    Italy: "it",
    "Ivory Coast": "ci",
    Japan: "jp",
    Mexico: "mx",
    Morocco: "ma",
    Netherlands: "nl",
    "New Zealand": "nz",
    Nigeria: "ng",
    Norway: "no",
    Panama: "pa",
    Paraguay: "py",
    Portugal: "pt",
    Qatar: "qa",
    "Saudi Arabia": "sa",
    Scotland: "gb-sct",
    Senegal: "sn",
    Serbia: "rs",
    "South Africa": "za",
    "South Korea": "kr",
    Spain: "es",
    Sweden: "se",
    Switzerland: "ch",
    Tunisia: "tn",
    Turkey: "tr",
    Uruguay: "uy",
    Uzbekistan: "uz",
    Jordan: "jo",
    USA: "us",
    "United States": "us",
  };
  return codes[name] ?? "";
}

function countryFlagUrl(teamName: string, countryName: string) {
  const code = countryFlagCode(teamName) || countryFlagCode(countryName);
  return code ? `https://flagcdn.com/w80/${code}.png` : undefined;
}

function matchupKey(home: string, away: string) {
  return `${normalizeTeamForMatchup(home)}__${normalizeTeamForMatchup(away)}`;
}

function normalizeTeamForMatchup(name: string) {
  return name.toLowerCase().replace("czechia", "czech republic").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function readApiFootballError(errors: unknown) {
  if (!errors) return "";
  if (Array.isArray(errors)) return errors.join(", ");
  if (typeof errors === "object") {
    return Object.values(errors as Record<string, unknown>)
      .filter(Boolean)
      .join(", ");
  }
  return String(errors);
}

function sendJson(res: ServerResponse, data: unknown, statusCode?: number) {
  const unavailable = typeof data === "object" && data !== null && "status" in data && data.status !== "ready";
  res.statusCode = statusCode ?? (unavailable ? 503 : 200);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
  return true;
}
