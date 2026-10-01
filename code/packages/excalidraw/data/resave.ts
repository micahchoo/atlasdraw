import type { MaybePromise } from "@atlasdraw/common/utility-types";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { getFileHandleType, isImageFileHandleType } from "./blob";

// eslint-disable-next-line no-restricted-imports -- upstream's export lives in the data barrel
import { exportCanvas, prepareElementsForExport } from ".";

import type { AppState, BinaryFiles } from "../types";

export const resaveAsImageWithScene = async (
  data: MaybePromise<{
    elements: readonly ExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
  }>,
  fileHandle: FileSystemFileHandle,
  filename: string,
) => {
  const fileHandleType = getFileHandleType(fileHandle);

  if (!isImageFileHandleType(fileHandleType)) {
    throw new Error(
      "fileHandle should exist and should be of type svg or png when resaving",
    );
  }

  let { elements, appState, files } = await data;

  const { exportBackground, viewBackgroundColor } = appState;

  appState = {
    ...appState,
    exportEmbedScene: true,
  };

  const { exportedElements, exportingFrame } = prepareElementsForExport(
    elements,
    appState,
    false,
  );

  await exportCanvas(fileHandleType, exportedElements, appState, files, {
    exportBackground,
    viewBackgroundColor,
    name: filename,
    fileHandle,
    exportingFrame,
  });

  return { fileHandle };
};
