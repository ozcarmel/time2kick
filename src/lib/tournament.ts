import type { Fixture } from "../types";

export type QualifyingPosition = "winner" | "runner-up" | "third" | "unknown";

export function groupFixturesByDate(fixtures: Fixture[]) {
  const grouped = new Map<string, Fixture[]>();
  fixtures
    .slice()
    .sort((a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime())
    .forEach((fixture) => {
      const key = fixture.kickoffUtc.slice(0, 10);
      grouped.set(key, [...(grouped.get(key) ?? []), fixture]);
    });

  return [...grouped.entries()];
}

export function visibleScheduleFixtures(fixtures: Fixture[]) {
  return fixtures.filter((fixture) => fixture.group || fixtureHasQualifiedKnockoutTeam(fixture));
}

export function nextUpcomingFixture(fixtures: Fixture[], now = Date.now()) {
  return fixtures
    .filter((fixture) => !isPastOrFinalFixture(fixture, now))
    .slice()
    .sort((a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime())[0];
}

export function isPastOrFinalFixture(fixture: Fixture, now = Date.now()) {
  return fixture.status === "final" || new Date(fixture.kickoffUtc).getTime() + 2 * 60 * 60 * 1000 < now;
}

export function fixtureHasQualifiedKnockoutTeam(fixture: Fixture) {
  return [fixture.homeTeam.name, fixture.awayTeam.name].some(isQualifiedTeamName);
}

export function isQualifiedTeamName(name: string) {
  return (
    !/^(home|away) team to be decided$/i.test(name) &&
    !/^[123][A-L](?:\/[A-L])*$/i.test(name) &&
    !/^[WL]\d+$/i.test(name)
  );
}

export function seedLabelToHuman(label: string) {
  const trimmed = label.trim();
  const groupPosition = trimmed.match(/^([12])([A-L])$/i);
  if (groupPosition) {
    return `${groupPosition[1] === "1" ? "Winner" : "Runner-up"} Group ${groupPosition[2].toUpperCase()}`;
  }

  const thirdPlace = trimmed.match(/^3([A-L](?:\/[A-L])*)$/i);
  if (thirdPlace) {
    return `Third-place team from Group ${thirdPlace[1].toUpperCase().split("/").join(", ")}`;
  }

  const winner = trimmed.match(/^W(\d+)$/i);
  if (winner) return `Winner of Match ${winner[1]}`;

  const loser = trimmed.match(/^L(\d+)$/i);
  if (loser) return `Loser of Match ${loser[1]}`;

  return isQualifiedTeamName(trimmed) ? "Qualified team" : "Team to be decided";
}

export function seedLabelInfo(label: string): { groupIds: string[]; position: QualifyingPosition } {
  const trimmed = label.trim().toUpperCase();
  const singleGroup = trimmed.match(/^[123]([A-L])$/);
  if (singleGroup) {
    const position = trimmed.startsWith("1") ? "winner" : trimmed.startsWith("2") ? "runner-up" : "third";
    return { groupIds: [singleGroup[1]], position };
  }

  const multiGroup = trimmed.match(/^3([A-L](?:\/[A-L])*)$/);
  if (multiGroup) return { groupIds: multiGroup[1].split("/"), position: "third" };

  return { groupIds: [], position: "unknown" };
}

export function qualifierClass(index: number, position: QualifyingPosition) {
  if (position === "unknown") return "";
  if (index === 0) return "qualifier-winner";
  if (index === 1) return "qualifier-runner";
  if (index === 2) return "qualifier-third";
  return "";
}

export function qualifierLabel(index: number, position: QualifyingPosition) {
  if (position === "unknown") return "";
  if (index === 0) return "Winner";
  if (index === 1) return "Runner-up";
  if (index === 2) return "Third";
  return "";
}

export function googleCalendarUrl(fixture: Fixture) {
  const start = new Date(fixture.kickoffUtc);
  const end = defaultFixtureEnd(start);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: calendarEventTitle(fixture),
    dates: `${googleDate(start)}/${googleDate(end)}`,
    details: calendarEventDescription(fixture),
    location: calendarEventLocation(fixture),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function calendarEventTitle(fixture: Fixture) {
  return `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;
}

export function calendarEventDescription(fixture: Fixture) {
  return `${fixture.stage}${fixture.group ? ` - ${fixture.group}` : ""}\nTime2Kick World Cup 2026 schedule.`;
}

export function calendarEventLocation(fixture: Fixture) {
  return `${fixture.venue}, ${fixture.city}, ${fixture.country}`;
}

export function defaultFixtureEnd(start: Date) {
  return new Date(start.getTime() + 2 * 60 * 60 * 1000);
}

export function icsEvent(fixture: Fixture, dtstamp = new Date()) {
  const start = new Date(fixture.kickoffUtc);
  const end = defaultFixtureEnd(start);

  return [
    "BEGIN:VEVENT",
    `UID:${fixture.id}@time2kick.local`,
    `DTSTAMP:${googleDate(dtstamp)}`,
    `DTSTART:${googleDate(start)}`,
    `DTEND:${googleDate(end)}`,
    `SUMMARY:${escapeIcs(calendarEventTitle(fixture))}`,
    `DESCRIPTION:${escapeIcs(`${fixture.stage}${fixture.group ? ` - ${fixture.group}` : ""}`)}`,
    `LOCATION:${escapeIcs(calendarEventLocation(fixture))}`,
    "END:VEVENT",
  ];
}

export function googleDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
