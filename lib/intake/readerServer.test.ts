import { describe, expect, it, vi } from "vitest";
import { isPrivateAddress, MAX_BYTES, readPostingPage, ReaderError, validateUrl, type Lookup, type Transport } from "./readerServer";

// No real network: DNS and the transport are stubs. Pages are made up.
const LD = JSON.stringify({ "@type": "JobPosting", title: "Software Engineer I", hiringOrganization: { name: "Brightloop" }, description: "<p>Build things in Python.</p>" });
const HTML = `<html><head><script type="application/ld+json">${LD}</script></head><body><p>Loading</p></body></html>`;
const html = (body = HTML, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const okLookup: Lookup = async () => PUBLIC;
const kind = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => (e instanceof ReaderError ? e.kind : `other:${String(e)}`)));

describe("isPrivateAddress", () => {
  it("blocks every private, loopback, link-local, CGNAT, multicast, reserved and metadata IPv4 address", () => {
    for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "127.8.8.8", "169.254.169.254", "169.254.0.1", "100.64.0.1", "100.127.255.255", "0.0.0.0", "0.1.2.3", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.0.5"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public IPv4 addresses, including near the edges of private ranges", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1", "192.167.1.1", "11.0.0.1", "223.255.255.255"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("blocks private IPv6: loopback, unspecified, unique local, link-local, multicast, mapped and embedded private IPv4", () => {
    for (const ip of ["::1", "::", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::1", "fd00:ec2::254", "fe80::1%eth0", "2001:db8::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public IPv6 and mapped public IPv4", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:81b::200e", "::ffff:8.8.8.8", "2002:0808:0808::1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("treats anything unparseable as private", () => {
    for (const ip of ["", "not-an-ip", "1.2.3", "300.1.1.1", "1::2::3", "12345::1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
});

describe("validateUrl", () => {
  it("accepts a normal https link", () => {
    expect(validateUrl("https://jobs.brightloop.example/job/123?utm_source=x").hostname).toBe("jobs.brightloop.example");
    expect(validateUrl("https://jobs.brightloop.example:443/x").port).toBe("");
  });
  it("rejects bad syntax, schemes, ports, credentials, dotless hosts and long links", async () => {
    const bad: unknown[] = ["", "nope", 5, null, "http://jobs.brightloop.example/x", "ftp://jobs.brightloop.example/x", "file:///etc/passwd", "javascript:alert(1)", "https://jobs.brightloop.example:8443/x", "https://jobs.brightloop.example:80/x", "https://user:pw@jobs.brightloop.example/x", "https://user@jobs.brightloop.example/x", "https://localhost/x", "https://intranet/x", `https://jobs.brightloop.example/${"a".repeat(2100)}`];
    for (const u of bad) expect(await kind(Promise.resolve().then(() => validateUrl(u))), String(u)).toBe("bad_url");
  });
  it("rejects literal IPs: private ones as private_address, public ones as bad_url", async () => {
    for (const u of ["https://127.0.0.1/", "https://10.1.2.3/x", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://[fd00::1]/", "https://[::ffff:127.0.0.1]/", "https://2130706433/", "https://0x7f.0.0.1/", "https://0177.0.0.1/", "https://127.1/"]) {
      expect(await kind(Promise.resolve().then(() => validateUrl(u))), u).toBe("private_address");
    }
    expect(await kind(Promise.resolve().then(() => validateUrl("https://93.184.216.34/")))).toBe("bad_url");
  });
  it("rejects internal-looking names", async () => {
    for (const u of ["https://printer.local/x", "https://api.internal/x", "https://foo.localhost/x", "https://db.corp/x"]) {
      expect(await kind(Promise.resolve().then(() => validateUrl(u))), u).toBe("private_address");
    }
  });
  it("refuses the boards the app never reads", async () => {
    for (const u of ["https://www.linkedin.com/jobs/view/1", "https://lnkd.in/abc", "https://www.indeed.com/viewjob?jk=1", "https://uk.indeed.com/x", "https://www.glassdoor.com/job/1", "https://jobright.ai/jobs/1", "https://www.linkedin.com./jobs/1"]) {
      expect(await kind(Promise.resolve().then(() => validateUrl(u))), u).toBe("blocked_host");
    }
  });
});

describe("readPostingPage", () => {
  const stub = (res: () => Response | Promise<Response>) => vi.fn<Transport>(async () => res());

  it("returns only the posting fields, never the page", async () => {
    const transport = stub(() => html());
    const r = await readPostingPage("https://jobs.brightloop.example/j/1", { lookup: okLookup, transport });
    expect(r.posting).toMatchObject({ title: "Software Engineer I", company: "Brightloop" });
    expect(r.closed).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Loading");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).toEqual(PUBLIC);
  });

  it("flags a page that also says the job is filled", async () => {
    const r = await readPostingPage("https://jobs.brightloop.example/j/1", { lookup: okLookup, transport: stub(() => html(HTML.replace("<p>Loading</p>", "<p>This job has been filled.</p>"))) });
    expect(r.closed).toBe(true);
  });

  it("no_posting carries the closed flag", async () => {
    const e = await readPostingPage("https://jobs.brightloop.example/j/1", { lookup: okLookup, transport: stub(() => html("<p>Sorry, this position is no longer available.</p>")) }).catch((x) => x);
    expect(e).toMatchObject({ kind: "no_posting", closed: true });
    const e2 = await readPostingPage("https://jobs.brightloop.example/j/1", { lookup: okLookup, transport: stub(() => html("<p>Hello</p>")) }).catch((x) => x);
    expect(e2).toMatchObject({ kind: "no_posting", closed: false });
  });

  it("rejects if ANY resolved address is private, and never connects", async () => {
    const transport = stub(() => html());
    for (const addrs of [[{ address: "10.0.0.5", family: 4 }], [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }], [{ address: "::1", family: 6 }], [{ address: "::ffff:192.168.0.1", family: 6 }]]) {
      expect(await kind(readPostingPage("https://jobs.brightloop.example/j/1", { lookup: async () => addrs, transport }))).toBe("private_address");
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("a failed or empty DNS lookup is a network error", async () => {
    const transport = stub(() => html());
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: async () => { throw new Error("ENOTFOUND"); }, transport }))).toBe("network");
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: async () => [], transport }))).toBe("network");
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses bad urls and blocked boards before any DNS or request", async () => {
    const lookup = vi.fn(okLookup);
    const transport = stub(() => html());
    expect(await kind(readPostingPage("http://jobs.brightloop.example/", { lookup, transport }))).toBe("bad_url");
    expect(await kind(readPostingPage("https://www.linkedin.com/jobs/view/1", { lookup, transport }))).toBe("blocked_host");
    expect(lookup).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("follows up to 3 redirects, resolving each Location (including relative ones) through the same checks", async () => {
    const seen: string[] = [];
    const lookup = vi.fn(okLookup);
    const transport: Transport = async (url) => {
      seen.push(url.toString());
      if (seen.length === 1) return new Response(null, { status: 302, headers: { location: "/en/job/1" } });
      if (seen.length === 2) return new Response(null, { status: 301, headers: { location: "https://careers.brightloop.example/final" } });
      return html();
    };
    const r = await readPostingPage("https://jobs.brightloop.example/j/1", { lookup, transport });
    expect(r.posting.title).toBe("Software Engineer I");
    expect(seen).toEqual(["https://jobs.brightloop.example/j/1", "https://jobs.brightloop.example/en/job/1", "https://careers.brightloop.example/final"]);
    expect(lookup.mock.calls.map((c) => c[0])).toEqual(["jobs.brightloop.example", "jobs.brightloop.example", "careers.brightloop.example"]);
  });

  it("stops after 3 redirects", async () => {
    const transport = vi.fn<Transport>(async () => new Response(null, { status: 302, headers: { location: "https://jobs.brightloop.example/again" } }));
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport }))).toBe("http_error");
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("re-validates every redirect target: http, private IPs, internal names, other ports, blocked boards, private DNS", async () => {
    const targets: [string, string][] = [
      ["http://careers.brightloop.example/x", "bad_url"],
      ["https://127.0.0.1/admin", "private_address"],
      ["https://169.254.169.254/latest/meta-data/", "private_address"],
      ["https://metadata.internal/x", "private_address"],
      ["https://careers.brightloop.example:8443/x", "bad_url"],
      ["https://www.linkedin.com/jobs/view/1", "blocked_host"],
      ["https://rebind.brightloop.example/x", "private_address"],
      ["https://user:pw@careers.brightloop.example/x", "bad_url"],
    ];
    for (const [to, expected] of targets) {
      const transport = vi.fn<Transport>(async () => new Response(null, { status: 302, headers: { location: to } }));
      const lookup: Lookup = async (h) => (h === "rebind.brightloop.example" ? [{ address: "10.0.0.9", family: 4 }] : PUBLIC);
      expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup, transport })), to).toBe(expected);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it("iCIMS: an outer page with no data is retried once as the in_iframe page, through the same checks", async () => {
    const seen: string[] = [];
    const lookup = vi.fn(okLookup);
    const transport: Transport = async (url) => {
      seen.push(url.toString());
      return url.searchParams.has("in_iframe") ? html() : html("<html><body><iframe src='x'></iframe></body></html>");
    };
    const r = await readPostingPage("https://careers-brightloop.icims.com/jobs/1234/engineer/job", { lookup, transport });
    expect(r.posting.title).toBe("Software Engineer I");
    expect(seen).toEqual(["https://careers-brightloop.icims.com/jobs/1234/engineer/job", "https://careers-brightloop.icims.com/jobs/1234/engineer/job?in_iframe=1"]);
    expect(lookup).toHaveBeenCalledTimes(2);
    // Other sites are not retried.
    seen.length = 0;
    expect(await kind(readPostingPage("https://jobs.brightloop.example/j/1", { lookup, transport: async (u) => (seen.push(u.toString()), html("<p>x</p>")) }))).toBe("no_posting");
    expect(seen).toHaveLength(1);
  });

  it("a redirect with no Location is an error", async () => {
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: stub(() => new Response(null, { status: 302 })) }))).toBe("http_error");
  });

  it("only reads text/html and application/xhtml+xml", async () => {
    for (const type of ["application/json", "application/pdf", "image/png", "text/plain", ""]) {
      expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: stub(() => new Response(HTML, { headers: type ? { "content-type": type } : {} })) })), type).toBe("not_html");
    }
    const r = await readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: stub(() => new Response(HTML, { headers: { "content-type": "application/xhtml+xml" } })) });
    expect(r.posting.title).toBe("Software Engineer I");
  });

  it("maps HTTP errors", async () => {
    for (const status of [403, 404, 410, 500]) {
      expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: stub(() => html("x", { status })) })), String(status)).toBe("http_error");
    }
  });

  it("stops reading after 3 MB: a posting found before the cut still works, otherwise too_large", async () => {
    const filler = "<p>x</p>".repeat(Math.ceil(MAX_BYTES / 8) + 10);
    let pulled = 0;
    const big = (head: string): Response => {
      const enc = new TextEncoder();
      let sent = false;
      return new Response(
        new ReadableStream({
          pull(c) {
            if (!sent) {
              sent = true;
              c.enqueue(enc.encode(head));
              return;
            }
            pulled++;
            if (pulled > 200) return c.close();
            c.enqueue(enc.encode(filler.slice(0, 100_000)));
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    };
    const r = await readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: async () => big(HTML) });
    expect(r.posting.title).toBe("Software Engineer I");
    pulled = 0;
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: async () => big("<html><body>") }))).toBe("too_large");
    expect(pulled).toBeLessThan(40);
  });

  it("times out when the page never answers", async () => {
    const transport: Transport = (_u, _a, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport, timeoutMs: 30 }))).toBe("timeout");
  });

  it("times out when DNS never answers", async () => {
    const lookup: Lookup = () => new Promise(() => {});
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup, transport: stub(() => html()), timeoutMs: 30 }))).toBe("timeout");
  });

  it("times out while the body is stalled", async () => {
    const transport: Transport = (_u, _a, signal) =>
      Promise.resolve(
        new Response(new ReadableStream({ start(c) { signal.addEventListener("abort", () => c.error(new Error("aborted"))); } }), { headers: { "content-type": "text/html" } }),
      );
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport, timeoutMs: 30 }))).toBe("timeout");
  });

  it("a connection failure is a network error", async () => {
    expect(await kind(readPostingPage("https://jobs.brightloop.example/", { lookup: okLookup, transport: async () => { throw new Error("ECONNRESET"); } }))).toBe("network");
  });
});
