# Review the standard starter schema

The standard starter is **Building Inspection & Maintenance Plan**. It is independent of the app survey and showcases 17 field types, including the top-level status and title fields. `FormLinkField` is intentionally omitted because it needs a real target form and host integration.

## Create an isolated review project

Use this checkout's CLI so the unpublished changes are included.

1. Open a terminal in `form0-cli`.
1. Run `node bin/form0.js init /tmp/form0-inspection-review` with a fresh directory name.
1. Choose **Standard project** if prompted.
1. Change directory to `/tmp/form0-inspection-review`.
1. Run `npm install`.
1. Run `npm test`. Expect the sample inspection to be valid, the footprint to be `96`, the planning allowance to be `2400`, and the copied follow-up contact to be `Alex Morgan`.
1. Run `node /home/aragornii/_dev/_paqu-io/form0-cli/bin/form0.js serve form.schema.json`.
1. Open the preview URL printed in the terminal, normally `http://localhost:3030`.

The generated project includes its own photo guide and uses the CLI's declared `form0-core` version range. It has no connector configuration.

## Inspect the form and events

1. Enter `BLD-001` in **Building reference**. The field accepts `BLD-` followed by three to six digits.
1. Enter `Riverside Community Hall` in **Building name**.
1. Enter `Alex Morgan` in **Assessor**.
1. Select **Good** in **Overall observed condition**. Expect **Suggested follow-up** to show **Routine review**.
1. Enter `12` in **Building length (m)** under **Area and allowance**.
1. Enter `8` in **Building width (m)**. Expect **Approximate footprint (m²)** to become `96`.
1. Enter `25` in **Maintenance allowance per m²**. Expect **Planning allowance** to become `2400`.
1. Choose **Yes** for **Use assessor as follow-up contact**. Expect `Alex Morgan` in **Follow-up contact**.
1. Replace **Follow-up contact** with `Sam Rivera`. Expect the copied field to remain editable.
1. Select **Urgent follow-up** in **Overall observed condition**. Expect an alert with relevant guidance.
1. Dismiss the alert. Expect **Urgent observation details** to appear and become required.
1. Enter `Water staining around the north window` in **Urgent observation details**.
1. Set **Follow-up date** to the day before **Inspection date**.
1. Click **Submit Record**. Expect `The follow-up date cannot be before the inspection date.` and no prepared submission.
1. Set **Follow-up date** to the day after **Inspection date**.
1. Click **Submit Record** again. Expect the date finding to clear and a structured record to be prepared locally.

The preview's **Form Settings** gear contains **Record preview** controls. **Open read-only** must be off for editing. The default event setup supports the validation rules; if you have saved different preview preferences, open **Advanced event settings**, enable event dispatch, and save the settings.

## Try repeatables and the building layout

1. Click **Add Inspected areas**.
1. Enter `Kitchen` in **Area name**.
1. Select **Needs attention** in **Area condition**. Expect the area reference to include `BLD-001 / Kitchen`.
1. Click **Add Observations** within this area.
1. Enter `Damp patch below the window` in **Observation**.
1. Select **Urgent follow-up** in **Follow-up priority**. Expect a guidance alert.
1. Dismiss the alert.
1. Enter `Arrange a follow-up visit` in **Proposed next action**.
1. Click **Save row** within the observation.
1. Click **Save row** within the inspected area.
1. Click **Add Proposed maintenance**.
1. Enter `Repaint the affected wall` in **Work description**.
1. Enter `2.5` in **Quantity**.
1. Enter `40` in **Unit cost**. Expect **Estimated cost** to become `100`.
1. Click **Save row** within the maintenance item.
1. Choose **Yes** for **Add a building layout**. Expect the layout editor to appear.
1. Draw a floor using the layout's floor tool. Expect a corresponding floor record with the optional **Floor reference** field.
1. Click **Add Rooms** in the form panel. Expect an open room editor and a default rectangle with four perimeter walls on the canvas.
1. Drag the room's interior on the canvas. Expect the room and its perimeter walls to move while the room editor stays open.
1. Drag a corner handle. Expect the room and its perimeter walls to resize without asking you to accept or cancel the editor.
1. Click **Cancel row** in the room editor. Expect a discard confirmation.
1. Confirm the discard. Expect the new room and its perimeter walls to disappear.

Continue: add a room or other plan component if you want to explore the plan editor. The separate **Inspected areas** rows hold the written observations; the plan does not automatically link those independently entered rows.

## Review evidence and sign-off

1. Review the photo checklist displayed inline beneath **Evidence notes**.
1. Click the image icon beside **Urgent observation details**. Expect the same checklist in a dialog.
1. Close the image dialog.
1. Select a local test photo in **Site photos**. Expect the photo to appear in the form.
1. Select a short local test clip in **Optional walkthrough video**, if available.
1. Enter `Reviewed with the maintenance coordinator` in **Review notes**.
1. Choose **Yes** for **Lock review notes**. Expect the notes to become read-only.
1. Choose **No** for **Lock review notes**. Expect the notes to become editable again.
1. Draw a signature in **Assessor signature**.

Reset: stop the preview with Ctrl+C and use a fresh review directory for a clean run. Keep any records or media you want before removing a review directory.

## App starters and historical reference

The web/mobile walkthrough is in each app repository at `docs/starter-schema-review.md`. Those starters contain Nature Observation, Equipment Checkout, and a separate Building Condition Survey.

The old standard template remains unchanged in `archive/starter-schemas/2026-10-31/`. Its manifest records the original source commit and SHA-256 hash. The archive is excluded from npm packing; the new standard template and its supporting image remain part of the CLI package.

The CLI preview uses 1Password's documented `data-1p-ignore` page attribute to opt out of its autofill/save prompts. Verify this in your Chrome extension; browser automation without the extension only checks the opt-out markup and the image control's focus behavior.
