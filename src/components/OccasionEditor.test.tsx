import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OccasionEditor } from "./OccasionEditor";
import type { Occasion } from "@/lib/album/types";

const EXISTING: Occasion[] = [
  { id: "one", title: "First date", onDate: "2026-02-14", yearly: true, coverItemId: null },
];

function openEditor(occasions: Occasion[] = EXISTING) {
  const onChange = vi.fn();
  render(<OccasionEditor occasions={occasions} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Name this day" }));
  return onChange;
}

function fillDraft(title: string, date: string) {
  fireEvent.change(screen.getByLabelText("Occasion name"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Occasion date"), { target: { value: date } });
}

function submit() {
  // The submit button and the trigger share a name while creating, so this
  // reaches the one inside the dialog rather than the one that opened it.
  const dialog = screen.getByRole("dialog");
  fireEvent.submit(dialog.getElementsByTagName("form")[0]);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("naming a day", () => {
  it("posts the name, the date and whether it repeats", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { occasion: { id: "two", title: "Birthday", onDate: "2026-03-01", yearly: true, coverItemId: null } },
        201,
      ),
    );
    openEditor();

    fillDraft("Birthday", "2026-03-01");
    fireEvent.click(screen.getByLabelText("Repeats every year"));
    submit();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/occasions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Birthday",
      onDate: "2026-03-01",
      yearly: true,
    });
  });

  it("adds the new day to the list without refetching", async () => {
    const made = { id: "two", title: "Birthday", onDate: "2026-03-01", yearly: false, coverItemId: null };
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ occasion: made }, 201));
    const onChange = openEditor();

    fillDraft("Birthday", "2026-03-01");
    submit();

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([...EXISTING, made]));
  });

  it("shows the server's own refusal rather than a generic one", async () => {
    // The server knows things this component does not -- that 2026-02-30 is
    // not a date, for one -- and its sentence is the one worth showing.
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "that is not a date" }, 400));
    const onChange = openEditor();

    fillDraft("Nonsense", "2026-02-30");
    submit();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("that is not a date"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("editing a day", () => {
  it("patches by id rather than creating a second one", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));
    const onChange = openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Edit First date" }));
    fillDraft("Our first evening", "2026-02-14");
    submit();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ id: "one", title: "Our first evening" });
    // Edited in place: still one occasion, not a second one alongside it.
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it("loads the existing values into the form so nothing is retyped", () => {
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit First date" }));
    expect(screen.getByLabelText("Occasion name")).toHaveProperty("value", "First date");
    expect(screen.getByLabelText("Occasion date")).toHaveProperty("value", "2026-02-14");
  });
});

describe("deleting a day", () => {
  it("says the photographs are safe before it will delete anything", async () => {
    // The sentence this panel exists to be able to say. A delete button next
    // to somebody's photographs is frightening unless it is explained in place.
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete First date" }));

    expect(screen.getByText(/only forgets the name/i)).toBeTruthy();
    expect(screen.getByText(/stay in the album/i)).toBeTruthy();
    // Nothing has been sent yet: the first press only asks.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("needs a second, different press to actually forget it", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));
    const onChange = openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Delete First date" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget this name" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("id=one");
    expect(init?.method).toBe("DELETE");
  });

  it("backs out without deleting when told to keep it", () => {
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete First date" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(screen.queryByText(/only forgets the name/i)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
