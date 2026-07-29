const DEFAULT_DURATION_MS = 8000;

let hideTimer: number | undefined;

function toastElement(): HTMLDivElement {
  let node = document.querySelector<HTMLDivElement>("#error-toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "error-toast";
    node.className = "error-toast";
    node.setAttribute("role", "alert");
    node.hidden = true;
    const header = document.querySelector("header");
    header?.insertAdjacentElement("afterend", node);
  }
  return node;
}

export function dismissErrorToast(): void {
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  const node = document.querySelector<HTMLDivElement>("#error-toast");
  if (!node) return;
  node.hidden = true;
  node.textContent = "";
  node.classList.remove("error-toast-visible");
}

/** Show a pale banner under the header; auto-hides after a few seconds. */
export function showErrorToast(message: string, durationMs = DEFAULT_DURATION_MS): void {
  const text = message.replace(/^Error:\s*/i, "").trim();
  if (!text) {
    dismissErrorToast();
    return;
  }

  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
  }

  const node = toastElement();
  node.textContent = text;
  node.hidden = false;
  node.classList.remove("error-toast-visible");
  void node.offsetWidth;
  node.classList.add("error-toast-visible");

  hideTimer = window.setTimeout(() => {
    hideTimer = undefined;
    node.classList.remove("error-toast-visible");
    window.setTimeout(() => {
      if (!node.classList.contains("error-toast-visible")) {
        node.hidden = true;
        node.textContent = "";
      }
    }, 300);
  }, durationMs);
}
