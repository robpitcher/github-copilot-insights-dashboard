import { describe, it, expect } from "vitest";
import type { CopilotUsageRecord } from "@/types/copilot-api";
import {
  computeRecordHash,
  transformToFactUsage,
  transformToFactFeatures,
  transformToFactIdes,
  transformToFactLanguages,
  transformToFactModels,
  transformToFactLanguageModels,
  transformToFactCli,
  extractUniqueIdes,
  extractUniqueFeatures,
  extractUniqueLanguages,
  extractUniqueModels,
  extractUniqueOrgIds,
  extractAiAdoptionPhase,
} from "../transform";

const mockRecord: CopilotUsageRecord = {
  day: "2026-04-15",
  enterprise_id: "123",
  user_id: 1001,
  user_login: "testuser",
  user_initiated_interaction_count: 50,
  code_generation_activity_count: 100,
  code_acceptance_activity_count: 75,
  used_agent: true,
  used_copilot_coding_agent: false,
  used_chat: true,
  used_cli: false,
  loc_suggested_to_add_sum: 500,
  loc_suggested_to_delete_sum: 100,
  loc_added_sum: 300,
  loc_deleted_sum: 50,
  totals_by_ide: [
    {
      ide: "vscode",
      user_initiated_interaction_count: 50,
      code_generation_activity_count: 100,
      code_acceptance_activity_count: 75,
    },
  ],
  totals_by_feature: [
    {
      feature: "chat",
      user_initiated_interaction_count: 30,
      code_generation_activity_count: 50,
      code_acceptance_activity_count: 40,
    },
  ],
  totals_by_language_feature: [
    {
      language: "typescript",
      feature: "chat",
      code_generation_activity_count: 50,
      code_acceptance_activity_count: 40,
    },
  ],
  totals_by_language_model: [
    {
      language: "typescript",
      model: "gpt-4o",
      code_generation_activity_count: 50,
      code_acceptance_activity_count: 40,
    },
  ],
  totals_by_model_feature: [
    {
      model: "gpt-4o",
      feature: "chat",
      user_initiated_interaction_count: 30,
      code_generation_activity_count: 50,
      code_acceptance_activity_count: 40,
    },
  ],
};

// ── computeRecordHash ──

describe("computeRecordHash", () => {
  it("should produce a consistent hash for the same input", () => {
    const hash1 = computeRecordHash(mockRecord);
    const hash2 = computeRecordHash(mockRecord);
    expect(hash1).toBe(hash2);
  });

  it("should return a 64-character hex string (SHA-256)", () => {
    const hash = computeRecordHash(mockRecord);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should produce different hashes for different input", () => {
    const altered: CopilotUsageRecord = { ...mockRecord, user_id: 9999 };
    expect(computeRecordHash(mockRecord)).not.toBe(computeRecordHash(altered));
  });

  it("should produce the same hash regardless of property order", () => {
    const ordered: CopilotUsageRecord = {
      day: mockRecord.day,
      enterprise_id: mockRecord.enterprise_id,
      user_id: mockRecord.user_id,
      user_login: mockRecord.user_login,
      user_initiated_interaction_count: mockRecord.user_initiated_interaction_count,
      code_generation_activity_count: mockRecord.code_generation_activity_count,
      code_acceptance_activity_count: mockRecord.code_acceptance_activity_count,
      used_agent: mockRecord.used_agent,
      used_copilot_coding_agent: mockRecord.used_copilot_coding_agent,
      used_chat: mockRecord.used_chat,
      used_cli: mockRecord.used_cli,
      loc_suggested_to_add_sum: mockRecord.loc_suggested_to_add_sum,
      loc_suggested_to_delete_sum: mockRecord.loc_suggested_to_delete_sum,
      loc_added_sum: mockRecord.loc_added_sum,
      loc_deleted_sum: mockRecord.loc_deleted_sum,
      totals_by_ide: mockRecord.totals_by_ide,
      totals_by_feature: mockRecord.totals_by_feature,
      totals_by_language_feature: mockRecord.totals_by_language_feature,
      totals_by_language_model: mockRecord.totals_by_language_model,
      totals_by_model_feature: mockRecord.totals_by_model_feature,
    };
    // Reverse-order object
    const reversed = Object.fromEntries(
      Object.entries(ordered).reverse()
    ) as unknown as CopilotUsageRecord;

    expect(computeRecordHash(ordered)).toBe(computeRecordHash(reversed));
  });
});

// ── transformToFactUsage ──

describe("transformToFactUsage", () => {
  it("should correctly map all fields from a CopilotUsageRecord", () => {
    const row = transformToFactUsage(mockRecord);
    expect(row).toEqual({
      day: "2026-04-15",
      enterpriseId: 123,
      organizationId: null,
      sourceTeamGithubId: null,
      userId: 1001,
      userLogin: "testuser",
      userInitiatedInteractionCount: 50,
      codeGenerationActivityCount: 100,
      codeAcceptanceActivityCount: 75,
      usedAgent: true,
      usedCopilotCodingAgent: false,
      usedCopilotCloudAgent: false,
      usedChat: true,
      usedCli: false,
      usedCodeReviewActive: false,
      usedCodeReviewPassive: false,
      locSuggestedToAddSum: 500,
      locSuggestedToDeleteSum: 100,
      locAddedSum: 300,
      locDeletedSum: 50,
      aiAdoptionPhase: null,
      aiAdoptionPhaseVersion: null,
    });
  });

  it("should parse organization_id when present", () => {
    const withOrg: CopilotUsageRecord = { ...mockRecord, organization_id: "456" };
    const row = transformToFactUsage(withOrg);
    expect(row.organizationId).toBe(456);
  });

  it("should default nullable numeric fields to 0 when undefined", () => {
    const minimal: CopilotUsageRecord = {
      ...mockRecord,
      user_initiated_interaction_count: undefined as unknown as number,
      code_generation_activity_count: undefined as unknown as number,
      loc_added_sum: undefined as unknown as number,
    };
    const row = transformToFactUsage(minimal);
    expect(row.userInitiatedInteractionCount).toBe(0);
    expect(row.codeGenerationActivityCount).toBe(0);
    expect(row.locAddedSum).toBe(0);
  });
});

// ── Dimension Extraction ──

describe("extractUniqueIdes", () => {
  it("should extract unique IDE names from records", () => {
    const result = extractUniqueIdes([mockRecord]);
    expect(result).toEqual(["vscode"]);
  });

  it("should de-duplicate IDEs across records", () => {
    const r2: CopilotUsageRecord = {
      ...mockRecord,
      totals_by_ide: [
        { ide: "vscode", user_initiated_interaction_count: 10, code_generation_activity_count: 20, code_acceptance_activity_count: 15 },
        { ide: "jetbrains", user_initiated_interaction_count: 5, code_generation_activity_count: 10, code_acceptance_activity_count: 8 },
      ],
    };
    const result = extractUniqueIdes([mockRecord, r2]);
    expect(result).toContain("vscode");
    expect(result).toContain("jetbrains");
    expect(result).toHaveLength(2);
  });

  it("should return empty array for empty input", () => {
    expect(extractUniqueIdes([])).toEqual([]);
  });
});

describe("extractUniqueFeatures", () => {
  it("should extract unique feature names", () => {
    const result = extractUniqueFeatures([mockRecord]);
    expect(result).toEqual(["chat"]);
  });

  it("should return empty array when totals_by_feature is missing", () => {
    const noFeatures = { ...mockRecord, totals_by_feature: undefined } as unknown as CopilotUsageRecord;
    expect(extractUniqueFeatures([noFeatures])).toEqual([]);
  });
});

describe("extractUniqueLanguages", () => {
  it("should extract languages from both language_feature and language_model", () => {
    const result = extractUniqueLanguages([mockRecord]);
    expect(result).toContain("typescript");
  });

  it("should de-duplicate across sources", () => {
    const result = extractUniqueLanguages([mockRecord]);
    expect(result).toHaveLength(1);
  });

  it("should return empty array for empty input", () => {
    expect(extractUniqueLanguages([])).toEqual([]);
  });
});

describe("extractUniqueModels", () => {
  it("should extract models from both language_model and model_feature", () => {
    const result = extractUniqueModels([mockRecord]);
    expect(result).toContain("gpt-4o");
  });

  it("should de-duplicate models", () => {
    const result = extractUniqueModels([mockRecord]);
    expect(result).toHaveLength(1);
  });
});

describe("extractUniqueOrgIds", () => {
  it("should extract numeric org IDs", () => {
    const withOrg: CopilotUsageRecord = { ...mockRecord, organization_id: "789" };
    expect(extractUniqueOrgIds([withOrg])).toEqual([789]);
  });

  it("should skip records without organization_id", () => {
    expect(extractUniqueOrgIds([mockRecord])).toEqual([]);
  });

  it("should de-duplicate org IDs", () => {
    const r1: CopilotUsageRecord = { ...mockRecord, organization_id: "10" };
    const r2: CopilotUsageRecord = { ...mockRecord, organization_id: "10" };
    expect(extractUniqueOrgIds([r1, r2])).toEqual([10]);
  });
});

// ── Fact Transform Functions ──

describe("transformToFactFeatures", () => {
  it("should map feature rows correctly", () => {
    const rows = transformToFactFeatures(mockRecord);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      day: "2026-04-15",
      userId: 1001,
      sourceTeamGithubId: null,
      featureName: "chat",
      userInitiatedInteractionCount: 30,
      codeGenerationActivityCount: 50,
      codeAcceptanceActivityCount: 40,
      locSuggestedToAddSum: 0,
      locSuggestedToDeleteSum: 0,
      locAddedSum: 0,
      locDeletedSum: 0,
    });
  });

  it("should return empty array when totals_by_feature is missing", () => {
    const noFeatures = { ...mockRecord, totals_by_feature: undefined } as unknown as CopilotUsageRecord;
    expect(transformToFactFeatures(noFeatures)).toEqual([]);
  });
});

describe("transformToFactIdes", () => {
  it("should map IDE rows correctly", () => {
    const rows = transformToFactIdes(mockRecord);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      day: "2026-04-15",
      userId: 1001,
      ideName: "vscode",
    });
  });
});

describe("transformToFactLanguages", () => {
  it("should map language rows from language_feature breakdowns", () => {
    const rows = transformToFactLanguages(mockRecord);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      languageName: "typescript",
      featureName: "chat",
    });
  });
});

describe("transformToFactModels", () => {
  it("should map model rows from model_feature breakdowns", () => {
    const rows = transformToFactModels(mockRecord);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelName: "gpt-4o",
      featureName: "chat",
    });
  });
});

describe("transformToFactLanguageModels", () => {
  it("should map language-model rows", () => {
    const rows = transformToFactLanguageModels(mockRecord);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      languageName: "typescript",
      modelName: "gpt-4o",
      codeGenerationActivityCount: 50,
      codeAcceptanceActivityCount: 40,
    });
  });
});

describe("transformToFactCli", () => {
  it("should return empty array when totals_by_cli is undefined", () => {
    expect(transformToFactCli(mockRecord)).toEqual([]);
  });

  it("should map CLI rows when data is present", () => {
    const withCli: CopilotUsageRecord = {
      ...mockRecord,
      totals_by_cli: {
        session_count: 5,
        request_count: 20,
        prompt_count: 15,
        last_known_cli_version: { cli_version: "1.2.3", sampled_at: "2026-04-15" },
        token_usage: { prompt_tokens_sum: 1000, output_tokens_sum: 500, avg_tokens_per_request: 75 },
      },
    };
    const rows = transformToFactCli(withCli);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      day: "2026-04-15",
      userId: 1001,
      sourceTeamGithubId: null,
      cliVersion: "1.2.3",
      sessionCount: 5,
      requestCount: 20,
      promptCount: 15,
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      avgTokensPerRequest: "75",
    });
  });

  it("should use 'unknown' when cli_version is missing", () => {
    const withCli: CopilotUsageRecord = {
      ...mockRecord,
      totals_by_cli: {
        session_count: 1,
        request_count: 1,
        prompt_count: 1,
        token_usage: { prompt_tokens_sum: 100, output_tokens_sum: 50, avg_tokens_per_request: 75 },
      },
    };
    const rows = transformToFactCli(withCli);
    expect(rows[0].cliVersion).toBe("unknown");
  });
});

describe("extractAiAdoptionPhase", () => {
  it("parses the documented object form with version", () => {
    expect(extractAiAdoptionPhase({ phase: 2, version: "v1" })).toEqual({ phase: 2, version: "v1" });
  });

  it("parses a bare numeric phase", () => {
    expect(extractAiAdoptionPhase(3)).toEqual({ phase: 3, version: null });
  });

  it("parses numeric string and string tokens", () => {
    expect(extractAiAdoptionPhase("1")).toEqual({ phase: 1, version: null });
    expect(extractAiAdoptionPhase("code_first")).toEqual({ phase: 1, version: null });
    expect(extractAiAdoptionPhase("AGENT_FIRST")).toEqual({ phase: 2, version: null });
    expect(extractAiAdoptionPhase("multi_agent")).toEqual({ phase: 3, version: null });
    expect(extractAiAdoptionPhase("no_cohort")).toEqual({ phase: 0, version: null });
  });

  it("parses 'phase N' style labels", () => {
    expect(extractAiAdoptionPhase("Phase 2 — agent first")).toEqual({ phase: 2, version: null });
  });

  it("returns null for missing, unknown, or out-of-range values", () => {
    expect(extractAiAdoptionPhase(undefined)).toEqual({ phase: null, version: null });
    expect(extractAiAdoptionPhase(null)).toEqual({ phase: null, version: null });
    expect(extractAiAdoptionPhase("nonsense")).toEqual({ phase: null, version: null });
    expect(extractAiAdoptionPhase(7)).toEqual({ phase: null, version: null });
  });

  it("preserves version even when phase is out of range", () => {
    expect(extractAiAdoptionPhase({ phase: 9, version: "v2" })).toEqual({ phase: null, version: "v2" });
  });

  it("is populated by transformToFactUsage", () => {
    const row = transformToFactUsage({ ...mockRecord, ai_adoption_phase: { phase: 2, version: "v1" } });
    expect(row.aiAdoptionPhase).toBe(2);
    expect(row.aiAdoptionPhaseVersion).toBe("v1");
  });

  it("leaves fact row phase null when field absent", () => {
    const row = transformToFactUsage(mockRecord);
    expect(row.aiAdoptionPhase).toBeNull();
    expect(row.aiAdoptionPhaseVersion).toBeNull();
  });
});
