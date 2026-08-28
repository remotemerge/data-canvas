export interface RecordedRequest {
  transport: 'fetch' | 'xhr';
  method: string;
  url: string;
  bodyHash?: string;
}

const requests: RecordedRequest[] = [];

const hashBody = async (body: unknown): Promise<string | undefined> => {
  if (body === undefined || body === null) return undefined;
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : String(body));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const record = (request: Omit<RecordedRequest, 'bodyHash'>, body?: unknown): void => {
  const entry: RecordedRequest = { ...request };
  requests.push(entry);
  void hashBody(body).then((bodyHash) => {
    if (bodyHash !== undefined) entry.bodyHash = bodyHash;
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
        url: new URL(request?.url ?? String(input), window.location.href).href,
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
    if (details !== undefined) record({ transport: 'xhr', ...details }, body);
    originalSend.call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
};

export const getRecordedRequests = (): readonly RecordedRequest[] => structuredClone(requests);
