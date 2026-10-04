// Candidate-only transform. No live installer or deployment pin is changed.
import { createHash } from 'node:crypto';

export const STAGING_BROWSER_ORIGIN = 'https://staging-barber.malabdullah.cloud';
export const UPSTREAM_LISTENER_SHA256 = '55f5b61fff7409a29f7fe2a0d4a35ba77cf83f849eb411ab89602b3f364f81bd';
const methods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD';
const allowHeaders = 'authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-upsert,cache-control,x-supabase-api-version,tus-resumable,upload-length,upload-offset,upload-metadata';
const exposeHeaders = 'content-range,range-unit,location,etag,retry-after,upload-offset,upload-length,tus-resumable';
const upstreamCors = `                    cors:
                      allow_origin_string_match:
                        - safe_regex:
                            regex: ".*"
                      allow_methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD,CONNECT,TRACE"
                      allow_headers: "*"
                      expose_headers: "*"
                      max_age: "3600"`;
const stagingCors = `                    cors:
                      allow_origin_string_match:
                        - exact: "${STAGING_BROWSER_ORIGIN}"
                      allow_methods: "${methods}"
                      allow_headers: "${allowHeaders}"
                      expose_headers: "${exposeHeaders}"
                      max_age: "600"
                      allow_credentials: false
                      forward_not_matching_preflights: false`;

// First on requests, last on responses: prevent backend wildcard/credential
// headers from broadening the policy. CORS is NOT a replacement for Auth/RLS,
// Cloudflare Access, webhook signatures or websocket authorization.
const guard = `                - name: barber.staging.origin_guard
                  typed_config:
                    '@type': type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                    inline_code: |
                      local origin = "${STAGING_BROWSER_ORIGIN}"
                      local namespace = "barber.staging.cors"
                      function envoy_on_request(handle)
                        local supplied = handle:headers():get("origin")
                        local allowed = supplied == origin
                        handle:streamInfo():dynamicMetadata():set(namespace, "allowed", allowed)
                        if supplied ~= nil and not allowed then
                          handle:respond({[":status"] = "403", ["content-type"] = "text/plain", ["vary"] = "Origin"}, "Origin not allowed")
                        end
                      end
                      function envoy_on_response(handle)
                        local headers = handle:headers()
                        local remove = {}
                        for key, _ in pairs(headers) do
                          if string.sub(key, 1, 15) == "access-control-" then
                            table.insert(remove, key)
                          end
                        end
                        for _, key in ipairs(remove) do headers:remove(key) end
                        local vary = headers:get("vary")
                        headers:replace("vary", vary and (vary .. ", Origin") or "Origin")
                        local metadata = handle:streamInfo():dynamicMetadata():get(namespace)
                        if metadata ~= nil and metadata.allowed == true then
                          headers:replace("access-control-allow-origin", origin)
                          headers:replace("access-control-allow-methods", "${methods}")
                          headers:replace("access-control-allow-headers", "${allowHeaders}")
                          headers:replace("access-control-expose-headers", "${exposeHeaders}")
                          headers:replace("access-control-max-age", "600")
                        end
                      end

`;

export function stagingEnvoyCors(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== UPSTREAM_LISTENER_SHA256) {
    throw new Error('Refusing unreviewed upstream gateway listener');
  }
  const marker = '              http_filters:\n';
  if (source.split(upstreamCors).length !== 2 || source.split(marker).length !== 2) {
    throw new Error('Unexpected upstream gateway structure');
  }
  return source.replace(upstreamCors, stagingCors).replace(marker, marker + guard);
}
