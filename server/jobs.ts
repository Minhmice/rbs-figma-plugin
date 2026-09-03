import type { InsertPayload } from "../src/shared/messages.js";

export type JobStage = "queued" | "downloading" | "converting" | "ready" | "error";

export type JobRecord = {
  id: string;
  stage: JobStage;
  message?: string;
  cached?: boolean;
  payload?: InsertPayload;
  error?: string;
  updatedAt: number;
};

const jobs = new Map<string, JobRecord>();
const TTL_MS = 10 * 60 * 1000;

function prune(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > TTL_MS) jobs.delete(id);
  }
}

export function createJob(id?: string): JobRecord {
  prune();
  const job: JobRecord = {
    id: id || `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    stage: "queued",
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Omit<JobRecord, "id">>
): JobRecord | null {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export function getJob(id: string): JobRecord | null {
  prune();
  return jobs.get(id) || null;
}
