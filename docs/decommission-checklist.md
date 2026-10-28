# Exact-resource cleanup

Use the private live inventory and deletion manifest, with an explicit keep,
remove or investigate decision for every resource. Check container IDs, Compose
ownership, all volume consumers, bind mounts, networks, domain routers, schedules,
credentials and deployment triggers immediately before deletion.

Keep production Supabase/customer data/backups and Dokploy's own PostgreSQL,
Redis and Traefik. Never infer ownership from the database technology or a short
container name. Remove only manifest entries; never use global Docker pruning.

The owner approved permanent discard of n8n/workers/their database/Redis, Ollama
models and retired Test/Staging data, without a new recovery archive. Production
data is excluded. Treat old Supabase data directories of uncertain ownership as
investigate until their contents/ownership are established.

After canonical-app cutover, remove duplicate Barber++ applications and domain
ownership, obsolete hooks/runners/secrets, cloud environments/preview resources,
and retired local stacks. Verify cloud Auth cleanup and remote tunnel deletion
with actual service evidence. A stopped listener does not prove tunnel deletion.

Re-inventory retained services and volumes, documenting their production purpose.
Remove temporary SSH firewall access and close the management tunnel at the end
of the implementation session. Preserve the original firewall rules.
