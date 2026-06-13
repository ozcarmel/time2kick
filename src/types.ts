export type Team = {
  providerId: string;
  name: string;
  country: string;
  code: string;
  logoUrl?: string;
  group?: string;
};

export type Standing = {
  team: Team;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  status?: string;
  description?: string;
};

export type Group = {
  id: string;
  name: string;
  standings: Standing[];
};

export type OddsMarket = {
  fixtureId: string;
  provider: string;
  bookmaker: string;
  market: "Match Winner";
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  homeAmericanOdds?: number;
  drawAmericanOdds?: number;
  awayAmericanOdds?: number;
  updatedAt: string;
};

export type Fixture = {
  id: string;
  providerFixtureId: string;
  group: string;
  round: string;
  stage: string;
  homeTeam: Team;
  awayTeam: Team;
  homeSeedLabel?: string;
  awaySeedLabel?: string;
  kickoffUtc: string;
  city: string;
  country: string;
  venue: string;
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
  score?: {
    home: number | null;
    away: number | null;
  };
  odds: OddsMarket | null;
};

export type BetSelection = "home" | "draw" | "away";

export type Bet = {
  id: string;
  fixtureId: string;
  matchLabel: string;
  selection: BetSelection;
  selectionLabel: string;
  stake: number;
  odds: number;
  potentialReturn: number;
  placedAt: string;
  status: "open" | "won" | "lost" | "void";
};

export type DesignScore = {
  category: string;
  score: number;
  reason: string;
};
