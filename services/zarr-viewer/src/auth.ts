export type StoreAuth =
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string };

/** Extract Basic credentials from a URL userinfo component. */
export function parseAuthFromUrl(url: URL): StoreAuth | undefined {
  if (!url.username && !url.password) return undefined;
  return {
    kind: "basic",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/** Parse `auth=bearer:<token>` viewer query param value. */
export function parseBearerAuthParam(value: string): StoreAuth | undefined {
  const match = value.match(/^bearer:(.+)$/i);
  if (!match) return undefined;
  const token = match[1].trim();
  if (!token) return undefined;
  return { kind: "bearer", token };
}

/** Serialize Bearer auth for the viewer URL query param. */
export function serializeBearerAuthParam(auth: StoreAuth): string | undefined {
  if (auth.kind !== "bearer") return undefined;
  return `bearer:${auth.token}`;
}

/** Embed Basic credentials into a store URL (Bearer uses a separate query param). */
export function applyAuthToUrl(baseUrl: string, auth?: StoreAuth): string {
  if (!auth || auth.kind !== "basic") return baseUrl;
  const url = new URL(baseUrl);
  url.username = auth.username;
  url.password = auth.password;
  const href = url.href;
  return href.endsWith("/") ? href : `${href}/`;
}

/** Remove userinfo from a store URL (for Bearer display). */
export function stripAuthFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    const href = parsed.href;
    return href.endsWith("/") ? href : `${href}/`;
  } catch {
    return url;
  }
}

/** Return a fetch function that injects Bearer Authorization when needed. */
export function createAuthFetch(auth?: StoreAuth): typeof fetch {
  if (!auth || auth.kind === "basic") {
    return fetch.bind(globalThis);
  }
  return (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${auth.token}`);
    return fetch(new Request(request, { headers }));
  };
}

export function authIndicator(auth?: StoreAuth): boolean {
  return auth !== undefined;
}

/** Human-readable auth label for metadata (never exposes secrets). */
export function formatAuthLabel(auth?: StoreAuth): string | undefined {
  if (!auth) return undefined;
  if (auth.kind === "basic") {
    return `Basic (${auth.username})`;
  }
  return "Bearer (configured)";
}

/** Resolve auth from viewer params: Bearer param takes precedence over URL userinfo. */
export function resolveStoreAuth(
  storeUrl: string,
  bearerParam?: string | null,
): StoreAuth | undefined {
  if (bearerParam) {
    const bearer = parseBearerAuthParam(bearerParam);
    if (bearer) return bearer;
  }
  try {
    return parseAuthFromUrl(new URL(storeUrl));
  } catch {
    return undefined;
  }
}

/** Store URL used for HTTP requests (userinfo for Basic, clean URL for Bearer). */
export function storeUrlForFetch(resolvedUrl: string, auth?: StoreAuth): string {
  const base = stripAuthFromUrl(resolvedUrl);
  if (auth?.kind === "basic") {
    return applyAuthToUrl(base, auth);
  }
  try {
    const parsed = new URL(resolvedUrl);
    if (parsed.username || parsed.password) {
      return resolvedUrl.endsWith("/") ? resolvedUrl : `${resolvedUrl}/`;
    }
  } catch {
    // fall through
  }
  return base;
}
