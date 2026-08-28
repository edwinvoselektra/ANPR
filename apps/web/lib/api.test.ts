import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API-fout", () => {
  it("bewaart veilige foutinformatie voor formulieren", () => {
    const error = new ApiError("Controleer de invoer", 409, { name: ["Verplicht"] }, "CAMERA_NAME_ALREADY_EXISTS");
    expect(error.message).toBe("Controleer de invoer");
    expect(error.status).toBe(409);
    expect(error.fields?.name).toEqual(["Verplicht"]);
    expect(error.code).toBe("CAMERA_NAME_ALREADY_EXISTS");
  });

  it("stuurt geen JSON-content-type mee met een bodyloze POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/cameras/camera-id/test", { method: "POST" });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
    expect(options.body).toBeUndefined();
  });

  it("stuurt voor een JSON-body wel het juiste content-type mee", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/cameras", { method: "POST", body: JSON.stringify({ name: "Uddel Noord" }) });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get("Content-Type")).toBe("application/json");
  });

  it("maakt de gestructureerde API-foutcode beschikbaar voor veldvalidatie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "CAMERA_NAME_ALREADY_EXISTS",
      message: "Er bestaat al een camera met deze naam.",
      fields: { name: ["Er bestaat al een camera met deze naam."] }
    }), { status: 409, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/cameras", { method: "POST", body: "{}" })).rejects.toMatchObject({
      status: 409,
      code: "CAMERA_NAME_ALREADY_EXISTS",
      fields: { name: ["Er bestaat al een camera met deze naam."] }
    });
  });
});
