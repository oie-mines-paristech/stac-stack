import {
  COLORMAP_NAMES,
  DEFAULT_COLORMAP,
  getColormapSwatchDataUrl,
  isColormapName,
  type ColormapName,
} from "../colormap.js";

export interface ColormapPickerHandle {
  setSelected(name: string): void;
}

export function mountColormapPicker(
  container: HTMLElement,
  selected: string,
  onChange: (name: string) => void,
): ColormapPickerHandle {
  container.innerHTML = "";
  container.className = "colormap-dropdown";

  const initial = isColormapName(selected) ? selected : DEFAULT_COLORMAP;
  let open = false;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "colormap-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerSwatch = document.createElement("img");
  triggerSwatch.className = "colormap-swatch";
  triggerSwatch.alt = "";
  triggerSwatch.width = 64;
  triggerSwatch.height = 12;

  const triggerLabel = document.createElement("span");
  triggerLabel.className = "colormap-name";

  const chevron = document.createElement("span");
  chevron.className = "colormap-chevron";
  chevron.textContent = "▾";

  trigger.append(triggerSwatch, triggerLabel, chevron);

  const menu = document.createElement("div");
  menu.className = "colormap-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Colormap");

  const options = new Map<string, HTMLButtonElement>();

  function updateTrigger(name: ColormapName): void {
    triggerSwatch.src = getColormapSwatchDataUrl(name);
    triggerLabel.textContent = name;
    for (const [cmap, button] of options) {
      const isSelected = cmap === name;
      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-selected", isSelected ? "true" : "false");
    }
  }

  function setOpen(next: boolean): void {
    open = next;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    container.classList.toggle("open", open);
  }

  for (const name of COLORMAP_NAMES) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "colormap-option";
    option.dataset.cmap = name;
    option.setAttribute("role", "option");

    const swatch = document.createElement("img");
    swatch.className = "colormap-swatch";
    swatch.alt = "";
    swatch.src = getColormapSwatchDataUrl(name);
    swatch.width = 64;
    swatch.height = 12;

    const label = document.createElement("span");
    label.className = "colormap-name";
    label.textContent = name;

    option.append(swatch, label);
    option.addEventListener("click", () => {
      updateTrigger(name);
      setOpen(false);
      onChange(name);
    });
    options.set(name, option);
    menu.appendChild(option);
  }

  trigger.addEventListener("click", () => setOpen(!open));

  document.addEventListener("click", (event) => {
    if (!open) return;
    const target = event.target;
    if (target instanceof Node && !container.contains(target)) {
      setOpen(false);
    }
  });

  container.append(trigger, menu);
  updateTrigger(initial);

  return {
    setSelected(name: string) {
      updateTrigger(isColormapName(name) ? name : DEFAULT_COLORMAP);
    },
  };
}
