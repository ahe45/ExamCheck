// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPseudonymSettingsOverview } from "../../shared/api/pseudonyms";
import { SystemSettingsOverviewPage } from "./SystemSettingsOverviewPage";

vi.mock("../../shared/api/pseudonyms", () => ({
  fetchPseudonymSettingsOverview: vi.fn(),
}));

describe("SystemSettingsOverviewPage", () => {
  beforeEach(() => {
    vi.mocked(fetchPseudonymSettingsOverview).mockReset();
  });

  it("loads every admission card through one batch query and reuses it for refresh", async () => {
    vi.mocked(fetchPseudonymSettingsOverview).mockResolvedValue([
      {
        name: "학생부교과",
        candidates: 30,
        dates: 1,
        schedules: 2,
        buildings: ["미술관"],
        setting: null,
        error: true,
      },
      {
        name: "실기전형",
        candidates: 20,
        dates: 2,
        schedules: 3,
        buildings: ["체육관"],
        setting: null,
        error: true,
      },
    ]);

    render(<SystemSettingsOverviewPage token="session-token" />, { wrapper: queryWrapper() });

    expect(await screen.findByRole("heading", { name: "학생부교과" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "실기전형" })).toBeInTheDocument();
    expect(fetchPseudonymSettingsOverview).toHaveBeenCalledOnce();
    expect(fetchPseudonymSettingsOverview).toHaveBeenCalledWith("session-token", "2026년도 자격시험");

    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(fetchPseudonymSettingsOverview).toHaveBeenCalledTimes(2));
  });
});

function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
