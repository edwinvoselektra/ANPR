import { describe, expect, it } from "vitest";
import { ApiError } from "./api";

describe("API-fout", () => {
  it("bewaart veilige foutinformatie voor formulieren", () => {
    const error = new ApiError("Controleer de invoer", 400, { name: ["Verplicht"] });
    expect(error.message).toBe("Controleer de invoer");
    expect(error.status).toBe(400);
    expect(error.fields?.name).toEqual(["Verplicht"]);
  });
});
