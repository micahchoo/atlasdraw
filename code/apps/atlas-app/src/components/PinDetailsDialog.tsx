// SPDX-License-Identifier: AGPL-3.0-only
//
// PinDetailsDialog — the title, description, link and photo of one pin.
//
// Surface decision (atlasdraw-ui-conventions, Rule 0): four fields and a
// file picker are a form, not a menu item, so it is a Modal like
// ShareDialog. It opens from the command "Edit pin details…"
// (commands.ts#tools.pin-details), which shows only while one pin is
// selected. The viewer and the embed show the details on a click
// (FeaturePopup); they do not edit them.
//
// Save writes all fields as one step of the drawing's history
// (state/pinDetails.ts#setPinDetails), so Ctrl+Z takes the edit back.
// A link must be http or https; the dialog refuses another and says why.
// A photo is an image file under Excalidraw's file cap. It becomes a file of
// the drawing, so it travels with the map and loads from no other host.

import React, { useId, useState } from "react";

import { LIMITS } from "@atlasdraw/protocol";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw/types";

import {
  PIN_LIMITS,
  photoUrlOf,
  readPinDetails,
  safeLink,
  setPinDetails,
  type PinPhoto,
} from "../state/pinDetails";

import styles from "../styles/PinDetailsDialog.module.css";

import { Modal } from "./Modal";

export interface PinDetailsDialogProps {
  api: ExcalidrawImperativeAPI;
  pinId: string;
  onClose: () => void;
}

/** A picked file as a data URL, or the reason it is refused. */
function readPhoto(file: File): Promise<PinPhoto | string> {
  if (!file.type.startsWith("image/")) {
    return Promise.resolve("Pick an image file (PNG, JPEG, WebP or GIF).");
  }
  if (file.size > LIMITS.record.image) {
    return Promise.resolve("The photo is too large. The limit is 4 MB.");
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ mimeType: file.type, dataURL: String(reader.result) });
    reader.onerror = () => resolve("The photo could not be read.");
    reader.readAsDataURL(file);
  });
}

export function PinDetailsDialog({
  api,
  pinId,
  onClose,
}: PinDetailsDialogProps) {
  const id = useId();
  const pin = api.getSceneElements().find((e) => e.id === pinId);
  const initial = readPinDetails(pin?.customData);
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [link, setLink] = useState(initial.link ?? "");
  const [keepPhoto, setKeepPhoto] = useState(Boolean(initial.photo));
  const [photo, setPhoto] = useState<PinPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownPhoto =
    photo?.dataURL ?? (keepPhoto ? photoUrlOf(initial, api.getFiles()) : null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const href = link.trim() === "" ? undefined : safeLink(link);
    if (href === null) {
      setError("The link must be a web address that starts with https://.");
      return;
    }
    setPinDetails(
      api,
      pinId,
      {
        title: title.trim(),
        description,
        link: href,
        photo: keepPhoto && !photo ? initial.photo : undefined,
      },
      photo ?? undefined,
    );
    onClose();
  };

  return (
    <Modal
      labelledBy={`${id}-heading`}
      onClose={onClose}
      scrimClassName={styles.scrim}
      scrimTestId="pin-details-dialog"
      className={styles.dialog}
    >
      <form onSubmit={save} noValidate className={styles.form}>
        <h2 id={`${id}-heading`} className={styles.heading}>
          Pin details
        </h2>

        <label className={styles.label} htmlFor={`${id}-title`}>
          Title
        </label>
        <input
          id={`${id}-title`}
          className={styles.input}
          type="text"
          maxLength={PIN_LIMITS.title}
          value={title}
          data-testid="pin-details-title"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        <label className={styles.label} htmlFor={`${id}-description`}>
          Description
        </label>
        <textarea
          id={`${id}-description`}
          className={styles.input}
          rows={4}
          maxLength={PIN_LIMITS.description}
          value={description}
          data-testid="pin-details-description"
          onChange={(e) => setDescription(e.target.value)}
        />

        <label className={styles.label} htmlFor={`${id}-link`}>
          Link
        </label>
        <input
          id={`${id}-link`}
          className={styles.input}
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="https://…"
          maxLength={PIN_LIMITS.link}
          value={link}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid="pin-details-link"
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
        />

        <span className={styles.label}>Photo</span>
        {shownPhoto && (
          <img
            className={styles.photo}
            src={shownPhoto}
            alt={title.trim() || "Pin"}
            data-testid="pin-details-photo"
          />
        )}
        <div className={styles.photoActions}>
          <label className={styles.button}>
            {shownPhoto ? "Replace photo…" : "Add photo…"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className={styles.srOnly}
              data-testid="pin-details-photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) {
                  return;
                }
                void readPhoto(file).then((result) => {
                  if (typeof result === "string") {
                    setError(result);
                  } else {
                    setPhoto(result);
                    setError(null);
                  }
                });
              }}
            />
          </label>
          {shownPhoto && (
            <button
              type="button"
              className={styles.button}
              data-testid="pin-details-photo-remove"
              onClick={() => {
                setPhoto(null);
                setKeepPhoto(false);
              }}
            >
              Remove photo
            </button>
          )}
        </div>

        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className={styles.error}
            data-testid="pin-details-error"
          >
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            data-testid="pin-details-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={[styles.button, styles.buttonPrimary].join(" ")}
            data-testid="pin-details-save"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
