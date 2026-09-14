import { z } from "zod";

// db/migrations/0068_download_jobs.sql — the watermarked-download
// background job. Enqueue returns just the id; the client polls status.
export const downloadJobStatusValueSchema = z.enum(["pending", "processing", "done", "failed"]);
export type DownloadJobStatusValue = z.infer<typeof downloadJobStatusValueSchema>;

export const enqueueDownloadResponseSchema = z.object({
  jobId: z.string().uuid(),
});
export type EnqueueDownloadResponse = z.infer<typeof enqueueDownloadResponseSchema>;

export const downloadJobStatusSchema = z.object({
  status: downloadJobStatusValueSchema,
  // Only set once status is 'done' — a short-lived signed URL to the
  // watermarked file, same TTL convention as every other signed object-
  // storage read in this codebase.
  downloadUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type DownloadJobStatus = z.infer<typeof downloadJobStatusSchema>;
