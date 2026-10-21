// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateDataPage } from "./CandidateDataPage";
import { candidateColumns } from "./candidate-data-model";
const api = vi.hoisted(() => ({
  fetchCandidatePage: vi.fn(),
  fetchCandidateFilterValues: vi.fn(),
  downloadCandidateData: vi.fn(),
}));
vi.mock("../../shared/api/candidates", () => api);
vi.mock("./CandidateUploadModal", () => ({ CandidateUploadModal: () => null }));
vi.mock("./CandidateDetailModal", () => ({ CandidateDetailModal: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchCandidatePage.mockResolvedValue({
    rows: [
      {
        ...Object.fromEntries(candidateColumns.map(({ key }) => [key, ""])),
        id: 1,
        name: "홍길동",
        examineeNo: "001",
        opt10: "추가정보 10",
      },
    ],
    total: 1,
    page: 1,
  });
});
describe("candidate OPT columns", () => {
  it("hides OPT1~10 by default and shows/collapses all ten columns without reloading records", async () => {
    render(<CandidateDataPage token="token" />);
    await screen.findByRole("row", { name: "홍길동 (001) 정보 수정" });
    expect(screen.queryByRole("button", { name: "OPT1" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "OPT 펼치기" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    for (let index = 1; index <= 10; index++)
      expect(screen.getByRole("button", { name: `OPT${index}` })).toBeInTheDocument();
    expect(screen.getByText("추가정보 10")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "OPT10" })).not.toBeInTheDocument();
    expect(screen.queryByText("추가정보 10")).not.toBeInTheDocument();
    expect(api.fetchCandidatePage).toHaveBeenCalledTimes(1);
  });
});
