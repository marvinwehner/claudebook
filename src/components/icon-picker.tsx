"use client";

import { Button, Label, Popover, useOverlayState } from "@heroui/react";
import { useId } from "react";
import { ListBox, ListBoxItem } from "react-aria-components";

import { NotebookIcon } from "@/components/notebook-icon";
import { NOTEBOOK_ICON_NAMES } from "@/lib/notebook-icons";

const CELL =
  "flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent";
const CELL_CURRENT = `${CELL} bg-accent text-accent-foreground`;
const CELL_IDLE = `${CELL} text-muted data-[hovered]:bg-surface-secondary data-[hovered]:text-foreground`;

/**
 * The grid is react-aria-components' own ListBox rather than HeroUI's.
 *
 * HeroUI has no icon picker, and its `.list-box-item` is a full-width row —
 * `min-h-9 w-full justify-start gap-3 px-2` — so dressing one up as a 32px
 * square means overriding nearly all of it. RAC's ListBox is the unstyled
 * primitive HeroUI is built on (already a direct dependency, same as the
 * DropZone in sources-rail), and `layout="grid"` is what makes arrow keys walk
 * the grid in two dimensions instead of running down 48 items in a line.
 *
 * `selectionMode` is deliberately left off. With selection enabled react-aria
 * treats a click as a selection change, so `onAction` never fires and clicking
 * the icon already chosen is a dead click — the selection did not change, so
 * nothing committed and the popover just sat there. Every cell here is an
 * action ("use this one, close"), and the current icon is drawn from `value`
 * rather than from a selection the list also has to hold.
 */
export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const state = useOverlayState();
  const triggerId = useId();

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={triggerId}>Icon</Label>

      <Popover isOpen={state.isOpen} onOpenChange={state.setOpen}>
        {/* The label carries the current icon, since the grid no longer
            reports one as selected. */}
        <Button id={triggerId} variant="secondary" isIconOnly aria-label={`Icon: ${value}`}>
          <NotebookIcon name={value} />
        </Button>

        <Popover.Content>
          <Popover.Dialog className="p-2">
            <ListBox
              aria-label="Notebook icon"
              // Without this the Dialog keeps focus and the arrow keys go
              // nowhere — the grid has to be what the popover focuses.
              autoFocus
              layout="grid"
              onAction={(name) => {
                onChange(String(name));
                state.close();
              }}
              className="grid grid-cols-8 gap-1"
            >
              {NOTEBOOK_ICON_NAMES.map((name) => (
                <ListBoxItem
                  key={name}
                  id={name}
                  textValue={name}
                  className={name === value ? CELL_CURRENT : CELL_IDLE}
                >
                  <NotebookIcon name={name} className="size-4" />
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
