import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calendarEventDescription,
  calendarEventLocation,
  calendarEventTitle,
  googleCalendarUrl,
  groupFixturesByDate,
  icsEvent,
  isPastOrFinalFixture,
  nextUpcomingFixture,
  qualifierClass,
  qualifierLabel,
  seedLabelInfo,
  seedLabelToHuman,
  visibleScheduleFixtures,
} from "../src/lib/tournament.ts";
import { loadTournamentSnapshot } from "../src/services/dataProviders.ts";

const mexico = team("Mexico", "mx");
const southAfrica = team("South Africa", "za");
const canada = team("Canada", "ca");
const bosnia = team("Bosnia & Herzegovina", "ba");
const czechRepublic = team("Czech Republic", "cz");

test("nextUpcomingFixture sorts upcoming games by kickoff instead of provider order", () => {
  const fixtures = [
    fixture("late", czechRepublic, southAfrica, "2026-06-18T22:00:00.000Z"),
    fixture("ended", mexico, southAfrica, "2026-06-11T19:00:00.000Z", { status: "final", score: { home: 2, away: 0 } }),
    fixture("next", canada, bosnia, "2026-06-12T19:00:00.000Z"),
  ];

  assert.equal(nextUpcomingFixture(fixtures, Date.parse("2026-06-12T12:00:00.000Z"))?.id, "next");
});

test("ended games are final and should not be treated as calendar targets", () => {
  const ended = fixture("ended", mexico, southAfrica, "2026-06-11T19:00:00.000Z", {
    status: "final",
    score: { home: 2, away: 0 },
  });

  assert.equal(isPastOrFinalFixture(ended, Date.parse("2026-06-12T12:00:00.000Z")), true);
});

test("visibleScheduleFixtures hides unresolved knockout placeholders but keeps qualified knockout games", () => {
  const unresolved = fixture("r32-placeholder", team("1A"), team("2B"), "2026-06-28T19:00:00.000Z", {
    group: "",
    stage: "Round of 32",
  });
  const resolved = fixture("r32-real", mexico, bosnia, "2026-06-28T19:00:00.000Z", {
    group: "",
    stage: "Round of 32",
  });

  assert.deepEqual(
    visibleScheduleFixtures([unresolved, resolved]).map((item) => item.id),
    ["r32-real"],
  );
});

test("groupFixturesByDate sorts fixtures within calendar days", () => {
  const grouped = groupFixturesByDate([
    fixture("night", mexico, southAfrica, "2026-06-12T22:00:00.000Z"),
    fixture("morning", canada, bosnia, "2026-06-12T10:00:00.000Z"),
  ]);

  assert.deepEqual(grouped[0][1].map((item) => item.id), ["morning", "night"]);
});

test("draw seed helpers identify group position and readable labels", () => {
  assert.deepEqual(seedLabelInfo("1A"), { groupIds: ["A"], position: "winner" });
  assert.deepEqual(seedLabelInfo("2B"), { groupIds: ["B"], position: "runner-up" });
  assert.deepEqual(seedLabelInfo("3A/B/C/D/F"), { groupIds: ["A", "B", "C", "D", "F"], position: "third" });
  assert.equal(seedLabelToHuman("W74"), "Winner of Match 74");
  assert.equal(qualifierClass(0, "winner"), "qualifier-winner");
  assert.equal(qualifierClass(1, "winner"), "qualifier-runner");
  assert.equal(qualifierClass(2, "winner"), "qualifier-third");
  assert.equal(qualifierLabel(2, "third"), "Third");
});

test("Google Calendar link and ICS event contain stable title, time, location, and escaped text", () => {
  const item = fixture("mx-za", mexico, southAfrica, "2026-06-11T19:00:00.000Z", {
    city: "Mexico City",
    country: "Mexico",
    venue: "Estadio Azteca",
  });
  const url = googleCalendarUrl(item);
  const parsed = new URL(url);
  const ics = icsEvent(item, new Date("2026-06-01T00:00:00.000Z")).join("\n");

  assert.equal(calendarEventTitle(item), "Mexico vs South Africa");
  assert.equal(calendarEventLocation(item), "Estadio Azteca, Mexico City, Mexico");
  assert.match(calendarEventDescription(item), /Time2Kick/);
  assert.equal(parsed.searchParams.get("text"), "Mexico vs South Africa");
  assert.equal(parsed.searchParams.get("dates"), "20260611T190000Z/20260611T210000Z");
  assert.match(ics, /UID:mx-za@time2kick.local/);
  assert.match(ics, /SUMMARY:Mexico vs South Africa/);
  assert.match(ics, /LOCATION:Estadio Azteca\\, Mexico City\\, Mexico/);
});

test("loadTournamentSnapshot retries short communication failures", async () => {
  let calls = 0;
  const payload = {
    status: "ready",
    provider: "openfootball",
    providerLabel: "OpenFootball public schedule",
    liveData: false,
    oddsAvailable: false,
    groups: [],
    fixtures: [],
    hostCities: [],
    lastSyncedAt: "2026-06-12T00:00:00.000Z",
  };
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) throw new Error("Temporary network failure");
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  const snapshot = await loadTournamentSnapshot(fetcher, 1, 0);

  assert.equal(calls, 2);
  assert.equal(snapshot.status, "ready");
});

test("loadTournamentSnapshot falls back to static snapshot when static hosting returns HTML for the API", async () => {
  const payload = {
    status: "ready",
    provider: "openfootball",
    providerLabel: "Static World Cup schedule",
    liveData: false,
    oddsAvailable: false,
    groups: [],
    fixtures: [],
    hostCities: [],
    lastSyncedAt: "2026-06-12T00:00:00.000Z",
  };
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(url);
    if (url === "/api/worldcup/snapshot") {
      return new Response("<!DOCTYPE html><html></html>", { status: 200 });
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  const snapshot = await loadTournamentSnapshot(fetcher, 0, 0);

  assert.deepEqual(requestedUrls, ["/api/worldcup/snapshot", "/worldcup-snapshot.json?v=2026-06-14-qatar-switzerland-1-1"]);
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.providerLabel, "Static World Cup schedule");
});

test("static snapshot includes Qatar vs Switzerland final result", async () => {
  const snapshot = JSON.parse(await readFile("public/worldcup-snapshot.json", "utf8"));
  const fixture = snapshot.fixtures.find(
    (item) =>
      item.kickoffUtc.startsWith("2026-06-13") &&
      new Set([item.homeTeam.name, item.awayTeam.name]).has("Qatar") &&
      new Set([item.homeTeam.name, item.awayTeam.name]).has("Switzerland"),
  );

  assert.ok(fixture, "Qatar vs Switzerland fixture should exist");
  assert.equal(fixture.status, "final");
  assert.deepEqual(fixture.score, { home: 1, away: 1 });
});

function team(name, flagCode = "") {
  return {
    providerId: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    country: name,
    code: "",
    logoUrl: flagCode ? `https://flagcdn.com/w80/${flagCode}.png` : undefined,
  };
}

function fixture(id, homeTeam, awayTeam, kickoffUtc, overrides = {}) {
  return {
    id,
    providerFixtureId: id,
    group: "Group A",
    round: "Matchday 1",
    stage: "Group",
    homeTeam,
    awayTeam,
    kickoffUtc,
    city: "Toronto",
    country: "Canada",
    venue: "BMO Field",
    status: "scheduled",
    score: { home: null, away: null },
    odds: null,
    ...overrides,
  };
}
