export class SolidTimeApiError extends Error {
  constructor(public status: number) {
    super(getErrorMessage(status));
    this.name = "SolidTimeApiError";
  }
}

function getErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Authentication failed. Verify your SOLIDTIME_API_TOKEN is valid.";
    case 403:
      return "Permission denied. Your token may lack access to this organization.";
    case 404:
      return "Resource not found. Use the list tools (e.g. solidtime_list_projects) to find valid IDs.";
    case 422:
      return "Validation failed. Check the tool arguments.";
    case 429:
      return "Rate limited. Wait a moment and try again.";
    default:
      if (status >= 500) return `SolidTime server error (${status}). Try again later.`;
      return `API error ${status}.`;
  }
}

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(
    baseUrl: string | undefined,
    token: string,
    private readOnly = true
  ) {
    if (!baseUrl) throw new Error("SOLIDTIME_API_URL is required.");
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error("Invalid SOLIDTIME_API_URL.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error(
        "SOLIDTIME_API_URL must be an HTTPS origin without credentials, a path, query, or fragment."
      );
    }
    if (!token || /\s/.test(token)) throw new Error("Invalid SOLIDTIME_API_TOKEN.");
    this.baseUrl = url.origin;
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.readOnly && method !== "GET") throw new Error("Write operations are disabled.");
    const url = new URL(
      path.startsWith("/api/v1/") ? `${this.baseUrl}${path}` : `${this.baseUrl}/api/v1${path}`
    );
    if (url.origin !== this.baseUrl || !url.pathname.startsWith("/api/v1/")) {
      throw new Error("Invalid API request path.");
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(
        "SolidTime request failed; redirects are blocked and requests time out after 30 seconds."
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (!response.ok) {
      throw new SolidTimeApiError(response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error("SolidTime returned an invalid JSON response.");
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.request<T>("GET", path);
    } catch (err) {
      if (err instanceof SolidTimeApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
