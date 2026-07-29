import { createAuthFetch, type StoreAuth } from "./auth.js";

export const CORS_STATIC_DEPLOYMENT_MESSAGE =
  "Accès bloqué par la politique CORS du navigateur. Ce viewer est déployé en statique et ne peut pas ouvrir cette ressource distante. Utilisez un store same-origin, un serveur qui expose les en-têtes CORS, ou un déploiement avec proxy HTTP (docker-compose).";

export class CorsBlockedError extends Error {
  constructor(message = CORS_STATIC_DEPLOYMENT_MESSAGE) {
    super(message);
    this.name = "CorsBlockedError";
  }
}

/** Relative or absolute path prefix for the same-origin Zarr HTTP proxy (opt-in). */
export function zarrProxyPrefix(): string | null {
  if (typeof window === "undefined") return null;

  const raw = import.meta.env?.VITE_ZARR_PROXY;
  if (raw === undefined || raw === "" || raw === "0" || raw === "false" || raw === "off") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function isCrossOriginUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function isLikelyCorsError(error: unknown, url: string): boolean {
  if (!isCrossOriginUrl(url)) return false;
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed")
  );
}

/** Rewrite an absolute store/chunk URL to go through the viewer proxy. */
export function toProxyUrl(absoluteUrl: string, proxyPrefix: string): string {
  const target = new URL(absoluteUrl);
  const proxyBase = new URL(proxyPrefix, window.location.href);
  const upstreamPath = `${target.protocol.replace(":", "")}/${target.host}${target.pathname}${target.search}`;
  return new URL(upstreamPath, proxyBase).href;
}

/** Try direct fetch first; on CORS failure, retry via same-origin proxy if configured. */
export function fetchWithCorsFallback(
  fetchFn: typeof fetch,
  proxyPrefix: string | null,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    try {
      return await fetchFn(request);
    } catch (error) {
      if (!isLikelyCorsError(error, request.url)) {
        throw error;
      }
      if (!proxyPrefix) {
        throw new CorsBlockedError();
      }
      const proxied = toProxyUrl(request.url, proxyPrefix);
      return fetchFn(new Request(proxied, request));
    }
  };
}

/** Fetch for Zarr stores: Authorization header + CORS-aware proxy fallback. */
export function createStoreFetch(auth?: StoreAuth): typeof fetch {
  return fetchWithCorsFallback(createAuthFetch(auth), zarrProxyPrefix());
}

/** Parse `/proxy/https/host/path` style paths (shared with the dev proxy). */
export function parseProxyRequestPath(
  requestPath: string,
): { scheme: string; host: string; path: string; search: string } | null {
  const match = requestPath.match(/\/proxy\/(https?)\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?$/);
  if (!match) return null;
  return {
    scheme: match[1],
    host: match[2],
    path: match[3] ?? "/",
    search: match[4] ?? "",
  };
}

export function upstreamUrlFromProxyPath(requestPath: string): string | null {
  const parsed = parseProxyRequestPath(requestPath);
  if (!parsed) return null;
  return `${parsed.scheme}://${parsed.host}${parsed.path}${parsed.search}`;
}
