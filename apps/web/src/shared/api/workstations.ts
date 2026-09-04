import { z } from "zod";
import { apiFetch } from "./client";

const workstationSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(1),
  name: z.string().min(1),
  location: z.string().nullable(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
});

const workstationsSchema = z.array(workstationSchema);

export type Workstation = z.infer<typeof workstationSchema>;

export function fetchWorkstations(token: string) {
  return apiFetch("/workstations", {}, token, workstationsSchema);
}
