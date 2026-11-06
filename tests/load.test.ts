import { describe, expect, test } from "bun:test";
import { loadRoute } from "../src/routes/load";

describe("loadRoute", () => {
  test("rejects invalid saved transposition offsets", async () => {
    const body = new URLSearchParams({
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
      offset: "1.5",
    });
    const response = await loadRoute(
      new Request("http://localhost/load", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("La preferencia de transposición no es válida.");
  });
});
