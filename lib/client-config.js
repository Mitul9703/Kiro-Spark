function trimTrailingSlash(value) {
  return (value || "").replace(/\/+$/, "");
}

export function getBackendHttpUrl() {
  return trimTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_HTTP_URL || "");
}

export function getBackendWsUrl() {
  const configured = trimTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_WS_URL || "");
  if (configured) {
    return configured;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}`;
}

export function getApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const backendHttpUrl = getBackendHttpUrl();
  return backendHttpUrl ? `${backendHttpUrl}${normalizedPath}` : normalizedPath;
}
