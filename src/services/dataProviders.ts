import type { Fixture, Group } from "../types";

export type ProviderStatus = {
  provider: "api-football" | "openfootball";
  configured: boolean;
  message: string;
  missingEnvVars?: string[];
  lastError?: string;
};

export type TournamentSnapshotReady = {
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

export type TournamentSnapshotUnavailable = {
  status: "configuration_required" | "provider_error";
  providerStatus: ProviderStatus;
};

export type TournamentSnapshot = TournamentSnapshotReady | TournamentSnapshotUnavailable;

export async function loadTournamentSnapshot(fetcher = fetch, retries = 2, retryDelayMs = 350): Promise<TournamentSnapshot> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchTournamentSnapshot(fetcher);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await wait(retryDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchTournamentSnapshot(fetcher: typeof fetch): Promise<TournamentSnapshot> {
  const response = await fetcher("/api/worldcup/snapshot");
  const payload = (await response.json()) as TournamentSnapshot;

  if (!response.ok && payload.status !== "configuration_required" && payload.status !== "provider_error") {
    throw new Error("World Cup data provider failed without a readable status.");
  }

  return payload;
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
