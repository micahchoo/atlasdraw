// Atlasdraw addition — the `searchSources` seam.
//
// The host (atlas-app) hands the search menu plain text plus a callback so
// that bodies of text the editor cannot see — anchored comments, which live
// in their own Y.Doc a package up — are still findable from the canvas search
// box. These cases pin the three things that make it a seam rather than a
// render slot: the editor does the matching, the host owns what a hit DOES,
// and a host-only hit is still a hit as far as "no match" is concerned.
//
// Sibling of search.test.tsx, and deliberately built on the same harness.

import React from "react";

import { CANVAS_SEARCH_TAB, CLASSES, DEFAULT_SIDEBAR } from "@atlasdraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { updateTextEditor } from "./queries/dom";
import { fireEvent, render, waitFor } from "./test-utils";

import type { SearchSource } from "../types";

const { h } = window;

const container = () => h.app.excalidrawContainerValue.container!;

const querySearchInput = async () => {
  const input = container().querySelector<HTMLInputElement>(
    `.${CLASSES.SEARCH_MENU_INPUT_WRAPPER} input`,
  )!;
  await waitFor(() => expect(input).not.toBeNull());
  return input;
};

const resultItems = () =>
  Array.from(container().querySelectorAll(".layer-ui__result-item"));

const resultTitles = () =>
  Array.from(
    container().querySelectorAll(".layer-ui__search-result-title"),
  ).map((el) => el.textContent);

const openSearch = async (sources?: readonly SearchSource[]) => {
  await render(<Excalidraw searchSources={sources} />);
  API.setAppState({
    openSidebar: { name: DEFAULT_SIDEBAR.name, tab: CANVAS_SEARCH_TAB },
  });
  return querySearchInput();
};

describe("searchSources", () => {
  it("renders a labelled group with its own count, and matches every occurrence", async () => {
    const sources: SearchSource[] = [
      {
        id: "comments",
        label: "Comments",
        entries: [
          { id: "c1", text: "the levee is the levee", onSelect: () => {} },
          { id: "c2", text: "check the levee", onSelect: () => {} },
          { id: "c3", text: "nothing to see", onSelect: () => {} },
        ],
      },
    ];

    const searchInput = await openSearch(sources);
    updateTextEditor(searchInput, "levee");

    await waitFor(() => {
      // 2 in c1 + 1 in c2 — occurrences, not entries, exactly as a scene text
      // element contributes one hit per occurrence.
      expect(resultItems()).toHaveLength(3);
    });
    expect(resultTitles()).toEqual(["Comments (3)"]);
  });

  it("hands the click back to the host and does nothing else", async () => {
    const onSelect = jest.fn();
    const searchInput = await openSearch([
      {
        id: "comments",
        label: "Comments",
        entries: [{ id: "c1", text: "find me", onSelect }],
      },
    ]);

    updateTextEditor(searchInput, "find");
    await waitFor(() => expect(resultItems()).toHaveLength(1));

    fireEvent.click(resultItems()[0]);

    expect(onSelect).toHaveBeenCalledTimes(1);
    // A host hit has no element, so it must never reach the canvas highlight
    // state — that is keyed by element id and would point at nothing.
    expect(h.app.state.searchMatches).toBeNull();
  });

  it("suppresses 'no match' when only a source matched", async () => {
    const searchInput = await openSearch([
      {
        id: "comments",
        label: "Comments",
        entries: [{ id: "c1", text: "only here", onSelect: () => {} }],
      },
    ]);

    // No scene elements at all, so the canvas side finds nothing.
    updateTextEditor(searchInput, "only");

    await waitFor(() => expect(resultItems()).toHaveLength(1));
    expect(
      container().querySelector(".layer-ui__search-count")?.textContent,
    ).not.toContain("No match");
  });

  it("still says 'no match' when nothing matched anywhere", async () => {
    const searchInput = await openSearch([
      {
        id: "comments",
        label: "Comments",
        entries: [{ id: "c1", text: "only here", onSelect: () => {} }],
      },
    ]);

    updateTextEditor(searchInput, "nowhere");

    await waitFor(() => {
      expect(
        container().querySelector(".layer-ui__search-count")?.textContent,
      ).toContain("No match");
    });
    expect(resultItems()).toHaveLength(0);
  });

  it("is inert when the host supplies nothing", async () => {
    const searchInput = await openSearch(undefined);
    updateTextEditor(searchInput, "anything");

    await waitFor(() => {
      expect(
        container().querySelector(".layer-ui__search-count")?.textContent,
      ).toContain("No match");
    });
    expect(resultTitles()).toEqual([]);
  });
});
