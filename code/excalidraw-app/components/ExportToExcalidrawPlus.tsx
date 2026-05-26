// stripped: Firebase + trackEvent (ADR 0006) Phase 0 Task 9b.
// ExportToExcalidrawPlus used firebase/storage directly (not via data/firebase.ts stub).
// The export-to-plus flow is Excalidraw-cloud-specific — not relevant for Atlasdraw Phase 0.
// Component kept as a disabled stub so import sites compile. Re-evaluate in Phase 5.

import React from "react";
// stripped: import { uploadBytes, ref } from "firebase/storage";
// stripped: import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { useI18n } from "@excalidraw/excalidraw/i18n";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export const exportToExcalidrawPlus = async (
  _elements: readonly NonDeletedExcalidrawElement[],
  _appState: Partial<AppState>,
  _files: BinaryFiles,
  _name: string,
): Promise<void> => {
  throw new Error(
    "exportToExcalidrawPlus: Firebase stripped in Phase 0 (ADR 0006). Will re-evaluate in Phase 5 if needed.",
  );
};

export const ExportToExcalidrawPlus: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name: string;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, files, name, onError, onSuccess }) => {
  const { t } = useI18n();
  return (
    <Card color="primary">
      <div className="Card-icon">
        <ExcalidrawLogo
          style={{
            [`--color-logo-icon` as any]: "#fff",
            width: "2.8rem",
            height: "2.8rem",
          }}
        />
      </div>
      <h2>Excalidraw+</h2>
      <div className="Card-details">
        {t("exportDialog.excalidrawplus_description")}
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title={t("exportDialog.excalidrawplus_button")}
        aria-label={t("exportDialog.excalidrawplus_button")}
        showAriaLabel={true}
        onClick={async () => {
          try {
            // stripped: trackEvent("export", "eplus", ...) — ADR 0006
            await exportToExcalidrawPlus(elements, appState, files, name);
            onSuccess();
          } catch (error: any) {
            console.error(error);
            if (error.name !== "AbortError") {
              onError(new Error(t("exportDialog.excalidrawplus_exportError")));
            }
          }
        }}
      />
    </Card>
  );
};
