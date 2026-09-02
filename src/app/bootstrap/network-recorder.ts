export interface RecordedRequest {
  transport: 'fetch' | 'xhr';
  method: string;
  url: string;
  bodyHash?: string;
}

const requests: RecordedRequest[] = [];

/*
 * Structured bodies (Blob, FormData, streams) have no useful string form: `String(body)` would
 * collapse every one of them to `[object Object]` and hash distinct requests identically. Those are
 * read as bytes instead, and anything unreadable is reported by constructor name rather than hashed.
 */
const bodyBytes = async (body: unknown): Promise<Uint8Array<ArrayBuffer> | string> => {
  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    // Copied because the view may be backed by a SharedArrayBuffer, which `digest` rejects.
    return Uint8Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString());
  }
  if (body instanceof FormData) {
    const parts: string[] = [];
    for (const [key, value] of body) {
      const encoded = typeof value === 'string' ? value : `file:${value.name}:${String(value.size)}`;
      parts.push(`${key}=${encoded}`);
    }
    return new TextEncoder().encode(parts.join('&'));
  }
  return `unhashable:${(body as object).constructor.name}`;
};

const hashBody = async (body: unknown): Promise<string | undefined> => {
  if (body === undefined || body === null) {
    return undefined;
  }

  const bytes = await bodyBytes(body);

  if (typeof bytes === 'string') {
    return bytes;
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const record = (request: Omit<RecordedRequest, 'bodyHash'>, body?: unknown): void => {
  const entry: RecordedRequest = { ...request };
  requests.push(entry);
  void hashBody(body).then((bodyHash) => {
    if (bodyHash !== undefined) {
      entry.bodyHash = bodyHash;
    }
  });
};

export const installNetworkRecorder = (): (() => void) => {
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const xhrDetails = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  window.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    record(
      {
        transport: 'fetch',
        method: init?.method ?? request?.method ?? 'GET',
        // `input` is narrowed to `string | URL` here; the `Request` form is read from `request`.
        url: new URL(request?.url ?? (input as string | URL), window.location.href).href,
      },
      init?.body,
    );
    return originalFetch(input, init);
  }) as typeof window.fetch;

  const patchedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    asynchronous = true,
    username?: string | null,
    password?: string | null,
  ): void {
    xhrDetails.set(this, { method, url: new URL(String(url), window.location.href).href });
    originalOpen.call(this, method, url, asynchronous, username, password);
  };
  XMLHttpRequest.prototype.open = patchedOpen as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (body): void {
    const details = xhrDetails.get(this);
    if (details !== undefined) {
      record({ transport: 'xhr', ...details }, body);
    }
    originalSend.call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
};

export const getRecordedRequests = (): readonly RecordedRequest[] => structuredClone(requests);
