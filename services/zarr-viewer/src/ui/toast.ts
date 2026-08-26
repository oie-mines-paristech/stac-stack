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

function hideToastNode(node: HTMLDivElement): void {
  node.hidden = true;
  node.textContent = "";
  node.classList.remove("error-toast-visible", "info-toast-visible");
  node.classList.remove("info-toast");
}

export function dismissErrorToast(): void {
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  const node = document.querySelector<HTMLDivElement>("#error-toast");
  if (!node) return;
  hideToastNode(node);
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
  node.classList.remove("info-toast", "info-toast-visible");
  node.classList.remove("error-toast-visible");
  void node.offsetWidth;
  node.classList.add("error-toast-visible");

  hideTimer = window.setTimeout(() => {
    hideTimer = undefined;
    node.classList.remove("error-toast-visible", "info-toast-visible");
    window.setTimeout(() => {
      if (
        !node.classList.contains("error-toast-visible") &&
        !node.classList.contains("info-toast-visible")
      ) {
        hideToastNode(node);
      }
    }, 300);
  }, durationMs);
}

/** Show an informational banner under the header; auto-hides after a few seconds. */
export function showInfoToast(message: string, durationMs = DEFAULT_DURATION_MS): void {
  const text = message.trim();
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
  node.classList.add("info-toast");
  node.classList.remove("error-toast-visible", "info-toast-visible");
  void node.offsetWidth;
  node.classList.add("info-toast-visible");

  hideTimer = window.setTimeout(() => {
    hideTimer = undefined;
    node.classList.remove("info-toast-visible");
    window.setTimeout(() => {
      if (!node.classList.contains("info-toast-visible")) {
        hideToastNode(node);
      }
    }, 300);
  }, durationMs);
}
