/**
 * TypeScript types matching the GitHub Copilot Usage Metrics API response.
 *
 * Based on the latest Copilot Usage Metrics API (preview, API version 2026-03-10).
 * Docs: https://docs.github.com/enterprise-cloud@latest/rest/copilot/copilot-usage-metrics
 * Schema: https://docs.github.com/enterprise-cloud@latest/copilot/reference/copilot-usage-metrics/example-schema
 */

// ── Report Envelope (returned by the API endpoint) ──

export interface CopilotMetricsReportResponse {
  download_links: string[];
  report_day?: string;
  report_start_day?: string;
  report_end_day?: string;
}

// ── Enterprise Organization (from /enterprises/{enterprise}/organizations) ──

export interface EnterpriseOrg {
  login: string;
  id: number;
  node_id?: string;
  url?: string;
  description?: string;
}

// ── Enterprise Team (from /enterprises/{enterprise}/teams) ──

export interface EnterpriseTeam {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface EnterpriseTeamMember {
  login: string;
  id: number;
  avatar_url?: string;
  type?: string;
  site_admin?: boolean;
}

// ── User-Level Record (each NDJSON line in a downloaded report) ──

export interface CopilotUsageRecord {
  day: string;
  report_start_day?: string;
  report_end_day?: string;
  enterprise_id: string;
  organization_id?: string;
  user_id: number;
  user_login: string;
  user_initiated_interaction_count: number;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  used_agent: boolean;
  used_copilot_coding_agent: boolean;
  used_copilot_cloud_agent?: boolean;
  used_chat: boolean;
  used_cli: boolean;
  used_copilot_code_review_active?: boolean;
  used_copilot_code_review_passive?: boolean;
  loc_suggested_to_add_sum: number;
  loc_suggested_to_delete_sum: number;
  loc_added_sum: number;
  loc_deleted_sum: number;

  // Chat mode breakdowns
  chat_panel_agent_mode?: number;
  chat_panel_ask_mode?: number;
  chat_panel_custom_mode?: number;
  chat_panel_edit_mode?: number;
  chat_panel_unknown_mode?: number;

  /**
   * AI adoption phase classification for the user over the rolling 28-day
   * window (Copilot Usage Metrics API, added 2026-05-29). The API nests the
   * numeric phase under `phase` with a `version` string so the classification
   * logic can evolve. Tolerant parsing also accepts a bare number or a string
   * token (e.g. "code_first"). See `extractAiAdoptionPhase` in transform.ts.
   */
  ai_adoption_phase?: AiAdoptionPhaseField;

  // Breakdown arrays / objects
  totals_by_ide: TotalsByIde[];
  totals_by_feature: TotalsByFeature[];
  totals_by_language_feature: TotalsByLanguageFeature[];
  totals_by_language_model: TotalsByLanguageModel[];
  totals_by_model_feature: TotalsByModelFeature[];
  totals_by_cli?: TotalsByCli;

  /** Injected at ingestion time when fetching per-org. Not from the API. */
  _orgLogin?: string;

  /**
   * Injected at ingestion time by joining the daily `user-teams` report on
   * `(user_id, day)`. Holds the GitHub team ID for team attribution.
   * Not part of the per-user usage report schema.
   */
  _teamGithubId?: number;
}

// ── AI Adoption Phase (cohorts, added 2026-05-29) ──

/**
 * The shape of the `ai_adoption_phase` field on user-level records. The API
 * returns an object with a numeric `phase` (0–3) and a `version` string, but we
 * also tolerate a bare number or string token for forward/backward safety.
 */
export type AiAdoptionPhaseField =
  | number
  | string
  | { phase?: number | string; version?: string }
  | null;

/** Canonical numeric AI adoption phase values. */
export const AI_ADOPTION_PHASES = [0, 1, 2, 3] as const;
export type AiAdoptionPhase = (typeof AI_ADOPTION_PHASES)[number];

/** Stable machine keys for each phase, used as i18n/label lookup keys. */
export const AI_ADOPTION_PHASE_KEYS: Record<AiAdoptionPhase, string> = {
  0: "noCohort",
  1: "codeFirst",
  2: "agentFirst",
  3: "multiAgent",
};

/** Human-readable English labels for each phase (fallback / non-i18n contexts). */
export const AI_ADOPTION_PHASE_LABELS: Record<AiAdoptionPhase, string> = {
  0: "No cohort",
  1: "Code-first",
  2: "Agent-first",
  3: "Multi-agent",
};

// ── Aggregate Record (enterprise-1-day / organization-1-day NDJSON) ──

export interface CopilotAggregateRecord {
  day: string;
  enterprise_id?: string;
  organization_id?: string;
  daily_active_users?: number;
  weekly_active_users?: number;
  monthly_active_users?: number;
  monthly_active_agent_users?: number;
  monthly_active_chat_users?: number;
  daily_active_cli_users?: number;
  pull_requests?: PullRequestMetrics;

  /** Injected at ingestion time. Not from the API. */
  _orgLogin?: string;
  _scope?: "enterprise" | "organization";
}

/**
 * A single NDJSON line from an entity-level aggregate report
 * (`enterprise-28-day`, `enterprise-1-day`, `organization-28-day`,
 * `organization-1-day`). Each line wraps an array of per-day totals under
 * `day_totals`, as shown in the official enterprise-level schema example.
 */
export interface AggregateReportLine {
  enterprise_id?: string;
  organization_id?: string;
  report_start_day?: string;
  report_end_day?: string;
  /** Present in the wrapped form: one entry per day. */
  day_totals?: CopilotAggregateRecord[];
  /** Present in the flat form: a single day's totals at the top level. */
  day?: string;
}

/**
 * A single NDJSON line from a `user-teams-1-day` report. One row per
 * `(user, team)` membership for the given day. Teams with fewer than 5 seated
 * Copilot users are omitted from these reports.
 */
export interface UserTeamRecord {
  user_id: number;
  user_login?: string;
  day: string;
  enterprise_id?: string;
  organization_id?: string;
  team_id: number;
  slug?: string;
}

export interface PullRequestMetrics {
  total_created?: number;
  total_reviewed?: number;
  total_merged?: number;
  median_minutes_to_merge?: number;
  total_suggestions?: number;
  total_applied_suggestions?: number;
  total_created_by_copilot?: number;
  total_reviewed_by_copilot?: number;
  total_merged_created_by_copilot?: number;
  total_merged_reviewed_by_copilot?: number;
  median_minutes_to_merge_copilot_authored?: number;
  median_minutes_to_merge_copilot_reviewed?: number;
  total_copilot_suggestions?: number;
  total_copilot_applied_suggestions?: number;
}

export interface TotalsByIde {
  ide: string;
  user_initiated_interaction_count: number;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
  loc_suggested_to_add_sum?: number;
  loc_suggested_to_delete_sum?: number;
  last_known_ide_version?: { ide_version: string; sampled_at: string };
  last_known_plugin_version?: { plugin: string; plugin_version: string; sampled_at: string };
}

export interface TotalsByFeature {
  feature: string;
  user_initiated_interaction_count: number;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
  loc_suggested_to_add_sum?: number;
  loc_suggested_to_delete_sum?: number;
}

export interface TotalsByLanguageFeature {
  language: string;
  feature: string;
  user_initiated_interaction_count?: number;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
  loc_suggested_to_add_sum?: number;
  loc_suggested_to_delete_sum?: number;
}

export interface TotalsByLanguageModel {
  language: string;
  model: string;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  loc_suggested_to_add_sum?: number;
  loc_suggested_to_delete_sum?: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
}

export interface TotalsByModelFeature {
  model: string;
  feature: string;
  user_initiated_interaction_count: number;
  code_generation_activity_count: number;
  code_acceptance_activity_count: number;
  loc_suggested_to_add_sum?: number;
  loc_suggested_to_delete_sum?: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
}

export interface TotalsByCli {
  session_count: number;
  request_count: number;
  prompt_count: number;
  last_known_cli_version?: { cli_version: string; sampled_at: string };
  token_usage: CliTokenUsage;
}

export interface CliTokenUsage {
  prompt_tokens_sum: number;
  output_tokens_sum: number;
  avg_tokens_per_request: number;
}

/** Raw API response is an array of usage records (NDJSON lines parsed) */
export type CopilotUsageApiResponse = CopilotUsageRecord[];
