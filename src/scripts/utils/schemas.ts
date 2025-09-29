import { z } from "zod";

/**
 * Schema for start_time field - must be HH:MM:SS format or 'unknown'
 */
export const StartTimeSchema = z
  .string()
  .regex(
    /^(\d{2}:\d{2}:\d{2}|unknown)$/,
    "start_time must be HH:MM:SS or 'unknown'"
  );

/**
 * Schema for individual fact within an episode
 */
export const FactSchema = z.object({
  fact_number: z.number().int().min(1).max(4),
  fact: z.string(),
  presenter: z.string(),
  guest: z.boolean(),
  start_time: StartTimeSchema,
});

/**
 * Schema for complete episode with facts
 * Includes custom validation rules:
 * - Standard episodes must have exactly 4 facts
 * - Non-standard episodes must have 0 or 4 facts
 * - If 4 facts exist, they must be numbered 1-4 exactly once
 */
export const EpisodeSchema = z
  .object({
    episode_number: z.string().min(1),
    episode_title: z.string().min(1),
    episode_type: z.enum(["standard", "compilation", "bonus", "other"]),
    episode_summary: z.string().min(1),
    facts: z.array(FactSchema),
  })
  .superRefine((obj, ctx) => {
    if (obj.episode_type === "standard") {
      if (obj.facts.length !== 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "standard episodes must have exactly 4 facts",
          path: ["facts"],
        });
      }
    } else {
      if (!(obj.facts.length === 0 || obj.facts.length === 4)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "non-standard episodes must have 0 or 4 facts",
          path: ["facts"],
        });
      }
    }
    if (obj.facts.length === 4) {
      const nums = new Set(obj.facts.map((f) => f.fact_number));
      if (![1, 2, 3, 4].every((n) => nums.has(n)) || nums.size !== 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "facts must include fact_number 1..4 exactly once",
          path: ["facts"],
        });
      }
    }
  });

/**
 * TypeScript types inferred from Zod schemas
 */
export type Fact = z.infer<typeof FactSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;
export type EpisodeType = Episode["episode_type"];