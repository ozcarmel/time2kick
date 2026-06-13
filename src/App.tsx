import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  Clock3,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  GitBranch,
  MapPin,
  Search,
  Star,
} from "lucide-react";
import { loadTournamentSnapshot, type TournamentSnapshot, type TournamentSnapshotReady } from "./services/dataProviders";
import type { Fixture, Group } from "./types";
import {
  googleCalendarUrl,
  groupFixturesByDate,
  icsEvent,
  isPastOrFinalFixture,
  qualifierClass,
  qualifierLabel,
  seedLabelInfo,
  seedLabelToHuman,
  visibleScheduleFixtures,
  type QualifyingPosition,
} from "./lib/tournament";
import "./styles.css";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const gmtTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const FAVORITE_TEAMS_KEY = "time2kick.favoriteTeams";

function App() {
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadTournamentSnapshot()
      .then(setSnapshot)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  if (loadError) {
    return <ProviderUnavailable message="Tournament schedule unavailable." detail={loadError} />;
  }

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <Activity aria-hidden="true" />
        <span>Loading World Cup schedule</span>
      </main>
    );
  }

  if (snapshot.status !== "ready") {
    return (
      <ProviderUnavailable
        message={snapshot.providerStatus.message}
        detail={snapshot.providerStatus.lastError}
        missingEnvVars={snapshot.providerStatus.missingEnvVars}
      />
    );
  }

  return <ScheduleApp snapshot={snapshot} />;
}

function ScheduleApp({ snapshot }: { snapshot: TournamentSnapshotReady }) {
  const route = useHashRoute();
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("All");
  const [groupsVisible, setGroupsVisible] = useState(true);
  const [favoriteTeams, setFavoriteTeams] = useStoredStringSet(FAVORITE_TEAMS_KEY);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const scheduleFixtures = useMemo(() => visibleScheduleFixtures(snapshot.fixtures), [snapshot.fixtures]);
  const groupStageFixtures = useMemo(() => scheduleFixtures.filter((fixture) => Boolean(fixture.group)), [scheduleFixtures]);
  const knockoutFixtures = useMemo(() => scheduleFixtures.filter((fixture) => !fixture.group), [scheduleFixtures]);
  const finalFixtures = useMemo(() => scheduleFixtures.filter((fixture) => /final/i.test(fixture.stage)), [scheduleFixtures]);
  const favoriteFixtures = useMemo(
    () => scheduleFixtures.filter((fixture) => fixtureMatchesFavorites(fixture, favoriteTeams)),
    [favoriteTeams, scheduleFixtures],
  );
  const kickoffCounts = useMemo(() => countFixturesByKickoff(scheduleFixtures), [scheduleFixtures]);

  const groupNames = useMemo(
    () => ["All", ...snapshot.groups.map((group) => group.name)],
    [snapshot.groups],
  );

  const filteredFixtures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return scheduleFixtures.filter((fixture) => {
      const matchesGroup = groupFilter === "All" || fixture.group === groupFilter;
      const matchesFavorites = !favoritesOnly || fixtureMatchesFavorites(fixture, favoriteTeams);
      const haystack = [
        fixture.homeTeam.name,
        fixture.awayTeam.name,
        fixture.group,
        fixture.stage,
        fixture.round,
        fixture.city,
        fixture.country,
        fixture.venue,
      ]
        .join(" ")
        .toLowerCase();

      return matchesGroup && matchesFavorites && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [favoriteTeams, favoritesOnly, groupFilter, query, scheduleFixtures]);

  const fixturesByDate = useMemo(() => groupFixturesByDate(filteredFixtures), [filteredFixtures]);
  const filteredUpcomingFixtures = upcomingFixtures(filteredFixtures);
  const nextFixtures = (filteredUpcomingFixtures.length > 0 ? filteredUpcomingFixtures : upcomingFixtures(scheduleFixtures)).slice(0, 2);

  if (route === "/draw") {
    return <DrawPage snapshot={snapshot} />;
  }

  return (
    <main className="app-shell">
      <header className="schedule-hero">
        <nav className="topbar" aria-label="Primary">
          <div aria-hidden="true" />
          <div className="topbar-actions">
            <a className="nav-link" href="#/draw">
              <GitBranch aria-hidden="true" />
              Full draw
            </a>
          </div>
        </nav>

        <section className="hero-content home-hero-content" aria-label="Next match">
          <div className="hero-logo-lockup">
            <img src="/time2kick-logo-vertical.png" alt="Time2Kick World Cup Schedule" />
          </div>
          <div className="next-match-stack" aria-label="Next two matches">
            {nextFixtures.length > 0 ? (
              nextFixtures.map((fixture) => <NextMatchCard fixture={fixture} key={fixture.id} />)
            ) : (
              <aside className="next-match-panel" aria-label="Next match">
                <span className="panel-label">Next match</span>
                <strong>No matches found</strong>
              </aside>
            )}
          </div>
        </section>
      </header>

      <section className={`groups-first ${groupsVisible ? "" : "is-collapsed"}`} aria-label="Groups">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Groups</span>
            <h2>{groupsVisible ? "Draw" : "Group view"}</h2>
          </div>
          <div className="section-actions">
            <button
              className="secondary-action"
              type="button"
              aria-expanded={groupsVisible}
              aria-controls="groups-grid"
              onClick={() => setGroupsVisible((visible) => !visible)}
            >
              {groupsVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {groupsVisible ? "Hide" : "Show"}
            </button>
            <a className="secondary-action link-action" href="#/draw">
              <GitBranch aria-hidden="true" />
              See full draw
            </a>
          </div>
        </div>
        {groupsVisible && (
          <div className="group-grid" id="groups-grid">
            {snapshot.groups.map((group) => (
              <article className="group-card" key={group.id}>
                <div className="group-title">
                  <span>{group.id}</span>
                  <h3>{group.name}</h3>
                </div>
                {group.standings.map((standing) => (
                  <div className="team-row" key={standing.team.providerId}>
                    <TeamLogo teamName={standing.team.name} logoUrl={standing.team.logoUrl} />
                    <strong>{standing.team.name}</strong>
                    <FavoriteButton
                      isFavorite={favoriteTeams.has(standing.team.name)}
                      teamName={standing.team.name}
                      onToggle={() => toggleStringSetValue(setFavoriteTeams, standing.team.name)}
                    />
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="schedule-toolbar" aria-label="Schedule filters">
        <label className="search-box">
          <Search aria-hidden="true" />
          <span className="sr-only">Search matches</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search team, city, venue, or round"
          />
        </label>
        <div className="group-filter" role="list" aria-label="Filter by group">
          <button
            className={favoritesOnly ? "active favorite-filter" : "favorite-filter"}
            type="button"
            onClick={() => setFavoritesOnly((enabled) => !enabled)}
          >
            <Star aria-hidden="true" />
            My teams
          </button>
          {groupNames.map((group) => (
            <button
              className={group === groupFilter ? "active" : ""}
              key={group}
              type="button"
              onClick={() => setGroupFilter(group)}
            >
              {group === "All" ? "All" : group.replace("Group ", "")}
            </button>
          ))}
        </div>
      </section>

      {favoriteTeams.size > 0 && (
        <section className="favorite-strip" aria-label="Favorite teams">
          <span>Following</span>
          {[...favoriteTeams].sort().map((teamName) => (
            <button key={teamName} type="button" onClick={() => toggleStringSetValue(setFavoriteTeams, teamName)}>
              <Star aria-hidden="true" />
              {teamName}
            </button>
          ))}
        </section>
      )}

      <section className="schedule-layout">
        <section className="schedule-list full-width" aria-label="World Cup matches">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Schedule</span>
              <h2>{filteredFixtures.length} confirmed games</h2>
            </div>
            <div className="calendar-scope-actions" aria-label="Calendar exports">
              <button className="secondary-action" type="button" onClick={() => downloadIcs(filteredFixtures, "time2kick-shown-games.ics")}>
                <Download aria-hidden="true" />
                Shown games
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={favoriteFixtures.length === 0}
                onClick={() => downloadIcs(favoriteFixtures, "time2kick-my-teams.ics")}
              >
                <Star aria-hidden="true" />
                My teams
              </button>
              <button className="secondary-action" type="button" onClick={() => downloadIcs(groupStageFixtures, "time2kick-group-stage.ics")}>
                <Download aria-hidden="true" />
                Group stage
              </button>
              <button className="secondary-action" type="button" onClick={() => downloadIcs(knockoutFixtures, "time2kick-knockouts.ics")}>
                <Download aria-hidden="true" />
                Knockouts
              </button>
              <button className="secondary-action" type="button" onClick={() => downloadIcs(finalFixtures, "time2kick-final.ics")}>
                <Download aria-hidden="true" />
                Final
              </button>
            </div>
          </div>

          {fixturesByDate.length === 0 ? (
            <div className="empty-state">No confirmed matches match your filters.</div>
          ) : (
            fixturesByDate.map(([dateKey, fixtures]) => (
              <article className="date-section" key={dateKey}>
                <h3>{fullDateFormatter.format(new Date(`${dateKey}T12:00:00Z`))}</h3>
                <div className="match-table">
                  {fixtures.map((fixture) => (
                    <FixtureRow concurrentCount={kickoffCounts.get(fixture.kickoffUtc) ?? 1} fixture={fixture} key={fixture.id} />
                  ))}
                </div>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  );
}

function NextMatchCard({ fixture }: { fixture: Fixture }) {
  return (
    <aside className="next-match-panel" aria-label="Next match">
      <span className="panel-label">Next match</span>
      <strong>
        {fixture.homeTeam.name} vs {fixture.awayTeam.name}
      </strong>
      <small>{fullDateFormatter.format(new Date(fixture.kickoffUtc))}</small>
      <small className="gmt-time">{gmtTimeFormatter.format(new Date(fixture.kickoffUtc))} GMT</small>
      {isPastOrFinalFixture(fixture) ? (
        <ScoreBadge fixture={fixture} />
      ) : (
        <a className="panel-calendar-link" href={googleCalendarUrl(fixture)} target="_blank" rel="noreferrer">
          <CalendarPlus aria-hidden="true" />
          Add to Google Calendar
        </a>
      )}
    </aside>
  );
}

function DrawPage({ snapshot }: { snapshot: TournamentSnapshotReady }) {
  const knockoutFixtures = useMemo(
    () => snapshot.fixtures.filter((fixture) => fixture.stage === "Round of 32"),
    [snapshot.fixtures],
  );
  const groupsById = useMemo(
    () => new Map(snapshot.groups.map((group) => [group.id.toUpperCase(), group])),
    [snapshot.groups],
  );

  return (
    <main className="app-shell">
      <header className="schedule-hero draw-hero">
        <nav className="topbar" aria-label="Primary">
          <a className="brand-mark" href="#/" aria-label="Time2Kick schedule">
            <img src="/time2kick-logo-hero.png" alt="Time2Kick" />
          </a>
          <div className="topbar-actions">
            <a className="nav-link" href="#/">
              <ArrowLeft aria-hidden="true" />
              Schedule
            </a>
          </div>
        </nav>
      </header>

      <section className="draw-page" aria-label="Full draw path">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Next stage</span>
            <h2>Round of 32</h2>
          </div>
        </div>

        <div className="draw-stage-list">
          <section className="draw-stage" aria-label="Round of 32">
            <div className="draw-match-grid">
              {knockoutFixtures.map((fixture) => (
                <DrawMatchCard fixture={fixture} groupsById={groupsById} key={fixture.id} />
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function DrawMatchCard({ fixture, groupsById }: { fixture: Fixture; groupsById: Map<string, Group> }) {
  return (
    <article className="draw-card">
      <div className="draw-card-meta">
        <span>Match {matchNumber(fixture)}</span>
        <small>
          {fixture.city} / {dateFormatter.format(new Date(fixture.kickoffUtc))}
        </small>
      </div>
      <div className="draw-matchup">
        <DrawSlot label={fixture.homeSeedLabel ?? fixture.homeTeam.name} groupsById={groupsById} />
        <span className="draw-vs">vs</span>
        <DrawSlot label={fixture.awaySeedLabel ?? fixture.awayTeam.name} groupsById={groupsById} />
      </div>
    </article>
  );
}

function DrawSlot({ label, groupsById }: { label: string; groupsById: Map<string, Group> }) {
  const seed = seedLabelInfo(label);
  const groupIds = seed.groupIds;

  return (
    <div className="draw-slot">
      <div className="draw-slot-label">
        <strong>{label}</strong>
        <span>{seedLabelToHuman(label)}</span>
      </div>
      {groupIds.length === 1 ? (
        <div className="draw-group-previews">
          <GroupPreview group={groupsById.get(groupIds[0])} position={seed.position} />
        </div>
      ) : groupIds.length > 1 ? (
        <CandidateGroupPool groupIds={groupIds} groupsById={groupsById} />
      ) : (
        <div className="draw-progression-note">{seedLabelToHuman(label)}</div>
      )}
    </div>
  );
}

function CandidateGroupPool({ groupIds, groupsById }: { groupIds: string[]; groupsById: Map<string, Group> }) {
  return (
    <div className="candidate-pool" aria-label="Third-place candidate groups">
      {groupIds.map((groupId) => {
        const group = groupsById.get(groupId);
        if (!group) return null;

        return (
          <div className="candidate-chip" key={group.id}>
            <span>{group.id}</span>
            <strong>{group.name}</strong>
            <small>Third</small>
          </div>
        );
      })}
    </div>
  );
}

function GroupPreview({ group, position }: { group: Group | undefined; position: QualifyingPosition }) {
  if (!group) {
    return null;
  }

  return (
    <section className="draw-group-preview" aria-label={group.name}>
      <div className="draw-group-preview-title">
        <span>{group.id}</span>
        <strong>{group.name}</strong>
      </div>
      <div className="draw-group-team-list">
        {group.standings.map((standing, index) => (
          <div className={`draw-group-team ${qualifierClass(index, position)}`} key={standing.team.providerId}>
            <TeamLogo teamName={standing.team.name} logoUrl={standing.team.logoUrl} />
            <span>{standing.team.name}</span>
            {qualifierLabel(index, position) && <small>{qualifierLabel(index, position)}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FixtureRow({ concurrentCount, fixture }: { concurrentCount: number; fixture: Fixture }) {
  const googleUrl = googleCalendarUrl(fixture);
  const showResult = isPastOrFinalFixture(fixture);
  const watchLabel = watchWindowLabel(fixture.kickoffUtc);

  return (
    <div className="match-row">
      <div className="match-time">
        <Clock3 aria-hidden="true" />
        <strong>{timeFormatter.format(new Date(fixture.kickoffUtc))}</strong>
        <span>{dateFormatter.format(new Date(fixture.kickoffUtc))}</span>
        <small>{gmtTimeFormatter.format(new Date(fixture.kickoffUtc))} GMT</small>
      </div>

      <div className="match-main">
        <div className="match-tags">
          <span className="match-stage">
            {fixture.stage}
            {fixture.group ? ` / ${fixture.group}` : ""}
          </span>
          <span className={`watch-pill ${watchLabel.className}`}>
            {watchLabel.label}
          </span>
          {concurrentCount > 1 && <span className="watch-pill overlap">Same kickoff</span>}
        </div>
        <div className="team-matchup">
          <TeamName teamName={fixture.homeTeam.name} logoUrl={fixture.homeTeam.logoUrl} />
          <span>vs</span>
          <TeamName teamName={fixture.awayTeam.name} logoUrl={fixture.awayTeam.logoUrl} alignEnd />
        </div>
      </div>

      <div className="match-location">
        <MapPin aria-hidden="true" />
        <span>
          <strong>{fixture.city}</strong>
          <small>{fixture.venue}</small>
        </span>
      </div>

      {showResult ? (
        <ScoreBadge fixture={fixture} />
      ) : (
        <a className="calendar-button" href={googleUrl} target="_blank" rel="noreferrer">
          <CalendarPlus aria-hidden="true" />
          <span>Add</span>
          <ExternalLink aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function FavoriteButton({
  isFavorite,
  onToggle,
  teamName,
}: {
  isFavorite: boolean;
  onToggle: () => void;
  teamName: string;
}) {
  return (
    <button
      className={`favorite-button ${isFavorite ? "is-favorite" : ""}`}
      type="button"
      aria-pressed={isFavorite}
      aria-label={`${isFavorite ? "Unfollow" : "Follow"} ${teamName}`}
      onClick={onToggle}
    >
      <Star aria-hidden="true" />
    </button>
  );
}

function ScoreBadge({ fixture }: { fixture: Fixture }) {
  const hasScore = fixture.score?.home !== null && fixture.score?.away !== null;

  return (
    <div className="score-badge" aria-label={`Final result ${fixture.homeTeam.name} ${fixture.score?.home ?? ""} ${fixture.awayTeam.name} ${fixture.score?.away ?? ""}`}>
      <span>Final</span>
      <strong>{hasScore ? `${fixture.score?.home} - ${fixture.score?.away}` : "Result pending"}</strong>
    </div>
  );
}

function TeamName({
  teamName,
  logoUrl,
  alignEnd = false,
}: {
  teamName: string;
  logoUrl?: string;
  alignEnd?: boolean;
}) {
  return (
    <div className={`team-name ${alignEnd ? "align-end" : ""}`}>
      <TeamLogo teamName={teamName} logoUrl={logoUrl} />
      <strong>{teamName}</strong>
    </div>
  );
}

function TeamLogo({ teamName, logoUrl }: { teamName: string; logoUrl?: string }) {
  if (!logoUrl) {
    return <span className="team-logo-placeholder" aria-label={`${teamName} flag placeholder`} />;
  }

  return <img className="team-logo" src={logoUrl} alt={`${teamName} flag`} loading="lazy" />;
}

function ProviderUnavailable({
  message,
  detail,
  missingEnvVars,
}: {
  message: string;
  detail?: string;
  missingEnvVars?: string[];
}) {
  return (
    <main className="setup-screen">
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="setup-icon">
          <AlertTriangle aria-hidden="true" />
        </div>
        <span className="eyebrow">Schedule unavailable</span>
        <h1 id="setup-title">World Cup schedule could not load</h1>
        <p>{message}</p>
        {missingEnvVars && (
          <div className="setup-requirements">
            <strong>Optional live-data environment</strong>
            {missingEnvVars.map((envVar) => (
              <code key={envVar}>{envVar}</code>
            ))}
          </div>
        )}
        {detail && <p className="setup-detail">{detail}</p>}
      </section>
    </main>
  );
}

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, "") || "/");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

function matchNumber(fixture: Fixture) {
  return fixture.id.replace(/^openfootball-/, "") || fixture.providerFixtureId;
}

function useStoredStringSet(key: string): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [values, setValues] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return new Set<string>(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify([...values]));
  }, [key, values]);

  return [values, setValues];
}

function toggleStringSetValue(setValues: Dispatch<SetStateAction<Set<string>>>, value: string) {
  setValues((current) => {
    const next = new Set(current);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  });
}

function fixtureMatchesFavorites(fixture: Fixture, favoriteTeams: Set<string>) {
  return favoriteTeams.has(fixture.homeTeam.name) || favoriteTeams.has(fixture.awayTeam.name);
}

function countFixturesByKickoff(fixtures: Fixture[]) {
  return fixtures.reduce((counts, fixture) => {
    counts.set(fixture.kickoffUtc, (counts.get(fixture.kickoffUtc) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}

function watchWindowLabel(kickoffUtc: string) {
  const kickoff = new Date(kickoffUtc);
  const hour = kickoff.getHours();
  const day = kickoff.getDay();
  const isWeekday = day >= 1 && day <= 5;

  if (hour < 6 || hour >= 23) return { className: "late", label: "Late night" };
  if (isWeekday && hour >= 9 && hour < 17) return { className: "work", label: "Work hours" };
  if (hour >= 18 && hour < 23) return { className: "prime", label: "Prime time" };
  return { className: "good", label: "Good time" };
}

function upcomingFixtures(fixtures: Fixture[], now = Date.now()) {
  return fixtures
    .filter((fixture) => !isPastOrFinalFixture(fixture, now))
    .slice()
    .sort((a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime());
}

function downloadIcs(fixtures: Fixture[], filename = "time2kick-world-cup-2026.ics") {
  if (fixtures.length === 0) return;

  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Time2Kick//Codex//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...fixtures.flatMap((fixture) => icsEvent(fixture)),
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default App;
