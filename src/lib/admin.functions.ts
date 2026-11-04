import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  clearAdminSession,
  hasAdminSession,
  loginWithAdminPassword,
  requireAdminSession,
} from "./admin-auth.server";

const projectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  x_handle: z.string().max(100).nullable(),
  x_url: z.string().url().max(500).nullable(),
  description: z.string().max(5000).nullable(),
  image_url: z.string().url().max(1000).nullable(),
  website: z.string().url().max(1000).nullable(),
  mint_url: z.string().url().max(1000).nullable(),
  rule: z.enum(["check_site", "public", "allowlist", "holder", "opensea"]),
  holder_contract: z.string().max(100).nullable(),
  opensea_slug: z.string().max(200).nullable(),
  mint_date: z.string().datetime().nullable(),
  price: z.string().max(100).nullable(),
});

export const adminLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ password: z.string().min(1).max(256) }).parse(input))
  .handler(async ({ data }) => {
    await loginWithAdminPassword(data.password);
    return { success: true };
  });

export const adminSession = createServerFn({ method: "GET" }).handler(async () => ({
  authenticated: await hasAdminSession(),
}));

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  clearAdminSession();
  return { success: true };
});

export const getAdminProjects = createServerFn({ method: "GET" })
  .middleware([requireAdminSession])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("chain", "ethereum")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not load projects: ${error.message}`);
    return data ?? [];
  });

export const createAdminProject = createServerFn({ method: "POST" })
  .middleware([requireAdminSession])
  .validator((input: unknown) => projectSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .insert({
        ...data,
        chain: "ethereum",
      })
      .select("id, name")
      .single();
    if (error) throw new Error(`Could not add project: ${error.message}`);
    return project;
  });

export const uploadAdminAllowlist = createServerFn({ method: "POST" })
  .middleware([requireAdminSession])
  .validator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        addresses: z
          .array(z.string().regex(/^0x[0-9a-fA-F]{40}$/))
          .min(1)
          .max(10_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (let offset = 0; offset < data.addresses.length; offset += 500) {
      const batch = data.addresses.slice(offset, offset + 500).map((wallet) => ({
        project_id: data.projectId,
        wallet: wallet.toLowerCase(),
      }));
      const { error } = await supabaseAdmin
        .from("allowlist_entries")
        .upsert(batch, { onConflict: "project_id,wallet", ignoreDuplicates: true });
      if (error) {
        throw new Error(
          `Allowlist upload failed after ${offset} addresses: ${error.message}. You can safely retry.`,
        );
      }
    }
    return { imported: data.addresses.length };
  });
