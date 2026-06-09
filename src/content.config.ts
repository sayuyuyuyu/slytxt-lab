import { defineCollection, z } from "astro:content";

const articleSchema = z.object({
  title: z.string(),
  description: z.string(),
  published: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
  adult: z.boolean().default(false),
  cover: z.string().optional()
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
  draft: z.boolean().default(false),
  cover: z.string().optional()
});

export const collections = {
  tech: defineCollection({ type: "content", schema: articleSchema }),
  life: defineCollection({ type: "content", schema: articleSchema }),
  projects: defineCollection({ type: "content", schema: projectSchema })
};
