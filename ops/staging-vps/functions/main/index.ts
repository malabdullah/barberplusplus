import { createGateway } from './gateway.ts';

declare const EdgeRuntime: {
  applySupabaseTag(original: Request, replacement: Request): void;
  userWorkers: {
    create(options: {
      servicePath: string; memoryLimitMb: number; workerTimeoutMs: number;
      noModuleCache: boolean; importMapPath: null; envVars: string[][];
      maybeEszip?: Uint8Array; allowRemoteModules: boolean;
    }): Promise<{ fetch(request: Request): Promise<Response> }>;
  };
};

if (Deno.env.get('APP_ENV') !== 'staging'
  || Deno.env.get('APP_URL') !== 'https://staging-barber.malabdullah.cloud') {
  throw new Error('VPS gateway requires the isolated staging environment');
}
const bundles = new Map<string, Uint8Array>();
const handler = createGateway({
  jwtSecret: Deno.env.get('JWT_SECRET'), jwks: Deno.env.get('SUPABASE_JWKS'),
  cronSecret: Deno.env.get('CRON_SHARED_SECRET'),
  metaAppSecret: Deno.env.get('WHATSAPP_APP_SECRET'),
  metaVerifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN'),
}, async (name, request) => {
  if (!bundles.has(name)) bundles.set(name, await Deno.readFile(`/home/deno/bundles/${name}.eszip`));
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: `/home/deno/functions/${name}`, memoryLimitMb: 150,
    workerTimeoutMs: 60000, noModuleCache: false, importMapPath: null,
    envVars: Object.entries(Deno.env.toObject()),
    maybeEszip: bundles.get(name), allowRemoteModules: false,
  });
  return await worker.fetch(request);
}, (original, replacement) => EdgeRuntime.applySupabaseTag(original, replacement));
Deno.serve(handler);
