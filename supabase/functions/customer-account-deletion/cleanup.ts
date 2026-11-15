type Data = Record<string, any>;
type Dependencies = {
  rpc: (action: string, data: Data) => Promise<any>;
  revoke: (task: Data) => Promise<void>;
  remove: (bucket: string, names: string[]) => Promise<{ error: unknown }>;
  deleteUser: (id: string) => Promise<{ error: { status?: number; code?: string } | null }>;
  warn: () => void;
};
export function createDeletionCleanup(deps: Dependencies) {
  return async (id: string) => {
    let job;
    try {
      job = await deps.rpc('claim', { id }); if (!job) return;
      for (const task of job.appleTasks || []) {
        await deps.revoke(task);
        if (await deps.rpc('apple-complete', { id: job.id, lease: job.lease, task: task.id }) !== true) throw Error('CLEANUP_PENDING');
      }
      const buckets = new Map<string, string[]>();
      for (const object of job.objects) buckets.set(object.bucket, [...(buckets.get(object.bucket) || []), object.name]);
      for (const [bucket, names] of buckets) if ((await deps.remove(bucket, names)).error) throw Error('CLEANUP_PENDING');
      for (const userId of job.userIds) {
        const { error } = await deps.deleteUser(userId);
        if (error && error.status !== 404 && error.code !== 'user_not_found') throw Error('CLEANUP_PENDING');
      }
      await deps.rpc('finish', { id: job.id, lease: job.lease });
    } catch {
      if (job) await deps.rpc('retry', { id: job.id, lease: job.lease }).catch(() => {});
      deps.warn();
    }
  };
}
