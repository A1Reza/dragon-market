import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewNotice } from "./review";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("identifies the deployed revision, pending approval and known defect (mocked metadata)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          environment: "temporary-human-review",
          commit: "a".repeat(40),
          implementation_baseline: "b".repeat(40),
          approval: "PENDING_HUMAN_REVIEW",
          isolated_runner: false,
          known_issue: "WAL-03 confirmed defect",
        }),
      ),
    ),
  );
  render(<ReviewNotice />);
  expect(await screen.findByText("a".repeat(40))).toBeInTheDocument();
  expect(screen.getByText(/WAL-03 confirmed defect/)).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Submit a reproducible/ }),
  ).toHaveAttribute("href", expect.stringContaining("human-review.yml"));
});
it("does not present unidentified deployment metadata as valid (mocked metadata)", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  render(<ReviewNotice />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Do not approve an unidentified deployment",
  );
});
it("disables hosted test execution and does not call the harness", async () => {
  vi.resetModules();
  vi.stubEnv("VITE_REVIEW_MODE", "true");
  // Re-import after setting the build-time configuration.
  const { ResearchLab: HostedLab } = await import("./ResearchLab");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<HostedLab run={vi.fn()} selectGuild={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Competing buyers/i }));
  expect(
    screen.getByRole("button", { name: /Local harness required/ }),
  ).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});
