import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const articleSchema = z.object({
  title: z.string(),
  // 一覧に出す説明。無いときは本文やタイトルで補う。
  description: z.string().optional(),
  published: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  adult: z.boolean().default(false)
});

const projectSchema = z.object({
  title: z.string(),
  description: z.string(),
  started: z.coerce.date(),
  updated: z.coerce.date().optional(),
  status: z.enum(["planning", "active", "maintenance", "paused", "completed"]),
  repo: z.string().url().optional(),
  demo: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false)
});

export const collections = {
  tech: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/tech" }),
    schema: articleSchema
  }),
  journal: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/journal" }),
    schema: articleSchema
  }),
  notes: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
    schema: articleSchema
  }),
  projects: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
    schema: projectSchema
  })
};
