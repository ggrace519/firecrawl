import { createServer, type IncomingHttpHeaders, type Server } from "http";
import type { AddressInfo } from "net";
import { generateText } from "ai";

// OPENAI_HEADERS lets an OpenAI-compatible server sit behind an auth proxy
// such as Cloudflare Access, which wants its own headers on every request.

let server: Server;
let baseURL: string;
let received: IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push(req.headers);
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1_700_000_000,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  received = [];
  vi.resetModules();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_BASE_URL", baseURL);
  vi.stubEnv("OLLAMA_BASE_URL", "");
  vi.stubEnv("MODEL_NAME", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OPENAI_HEADERS", () => {
  it("sends the configured headers with OpenAI-provider requests", async () => {
    vi.stubEnv(
      "OPENAI_HEADERS",
      JSON.stringify({
        "CF-Access-Client-Id": "client-id.access",
        "CF-Access-Client-Secret": "client-secret",
      }),
    );
    const { getModel } = await import("./generic-ai.js");

    const { text } = await generateText({
      model: getModel("test-model"),
      prompt: "hi",
    });

    expect(text).toBe("ok");
    expect(received).toHaveLength(1);
    expect(received[0]["cf-access-client-id"]).toBe("client-id.access");
    expect(received[0]["cf-access-client-secret"]).toBe("client-secret");
    expect(received[0].authorization).toBe("Bearer test-key");
  });

  it("sends no extra headers when unset", async () => {
    vi.stubEnv("OPENAI_HEADERS", "");
    const { getModel } = await import("./generic-ai.js");

    await generateText({ model: getModel("test-model"), prompt: "hi" });

    expect(received).toHaveLength(1);
    expect(received[0]["cf-access-client-id"]).toBeUndefined();
  });

  it.each([
    ["is not JSON", "CF-Access-Client-Id: abc"],
    ["has a non-string value", '{"CF-Access-Client-Id":1}'],
  ])("rejects config that %s", async (_, value) => {
    vi.stubEnv("OPENAI_HEADERS", value);

    await expect(import("../config.js")).rejects.toThrow(/OPENAI_HEADERS/);
  });
});
