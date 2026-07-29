import type { StoreAuth } from "../auth.js";
import { authIndicator } from "../auth.js";

export interface AuthDialogOptions {
  getStoreUrl: () => string;
  getAuth: () => StoreAuth | undefined;
  onSave: (storeUrl: string, auth: StoreAuth | undefined) => void;
}

export function wireAuthDialog(options: AuthDialogOptions): {
  updateIndicator: () => void;
} {
  function el<T extends HTMLElement>(selector: string): T {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing element ${selector}`);
    return node as T;
  }

  const button = el<HTMLButtonElement>("#auth-btn");
  const dialog = el<HTMLDialogElement>("#auth-dialog");
  const modeBasic = el<HTMLInputElement>("#auth-mode-basic");
  const modeBearer = el<HTMLInputElement>("#auth-mode-bearer");
  const basicFields = el<HTMLDivElement>("#auth-basic-fields");
  const bearerFields = el<HTMLDivElement>("#auth-bearer-fields");
  const usernameInput = el<HTMLInputElement>("#auth-username");
  const passwordInput = el<HTMLInputElement>("#auth-password");
  const tokenInput = el<HTMLInputElement>("#auth-token");
  const saveButton = el<HTMLButtonElement>("#auth-save");
  const clearButton = el<HTMLButtonElement>("#auth-clear");
  const cancelButton = el<HTMLButtonElement>("#auth-cancel");

  function syncModeVisibility(): void {
    const isBasic = modeBasic.checked;
    basicFields.hidden = !isBasic;
    bearerFields.hidden = isBasic;
  }

  function populateFromState(): void {
    const auth = options.getAuth();
    usernameInput.value = "";
    passwordInput.value = "";
    tokenInput.value = "";

    if (auth?.kind === "basic") {
      modeBasic.checked = true;
      usernameInput.value = auth.username;
      passwordInput.value = auth.password;
    } else if (auth?.kind === "bearer") {
      modeBearer.checked = true;
      tokenInput.value = auth.token;
    } else {
      modeBasic.checked = true;
    }
    syncModeVisibility();
  }

  function updateIndicator(): void {
    button.classList.toggle("auth-active", authIndicator(options.getAuth()));
  }

  button.addEventListener("click", () => {
    populateFromState();
    dialog.showModal();
  });

  modeBasic.addEventListener("change", syncModeVisibility);
  modeBearer.addEventListener("change", syncModeVisibility);

  cancelButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });

  clearButton.addEventListener("click", () => {
    options.onSave(options.getStoreUrl(), undefined);
    dialog.close();
    updateIndicator();
  });

  saveButton.addEventListener("click", () => {
    const storeUrl = options.getStoreUrl().trim();
    if (!storeUrl) {
      dialog.close();
      return;
    }

    let auth: StoreAuth | undefined;
    if (modeBearer.checked) {
      const token = tokenInput.value.trim();
      auth = token ? { kind: "bearer", token } : undefined;
    } else {
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      auth = username ? { kind: "basic", username, password } : undefined;
    }

    options.onSave(storeUrl, auth);
    dialog.close();
    updateIndicator();
  });

  updateIndicator();
  return { updateIndicator };
}

export function authDialogMarkup(): string {
  return `
    <dialog id="auth-dialog" class="auth-dialog">
      <form method="dialog" class="auth-dialog-form">
        <h2>Store authentication</h2>
        <p class="muted auth-warning">
          Credentials will be included in the viewer URL (browser history, logs, sharing).
        </p>
        <fieldset class="auth-mode-fieldset">
          <legend>Mode</legend>
          <label class="auth-mode-option">
            <input type="radio" name="auth-mode" id="auth-mode-basic" value="basic" checked />
            Username and password
          </label>
          <label class="auth-mode-option">
            <input type="radio" name="auth-mode" id="auth-mode-bearer" value="bearer" />
            Bearer token
          </label>
        </fieldset>
        <div id="auth-basic-fields" class="auth-fields">
          <label class="control">
            Login
            <input id="auth-username" type="text" autocomplete="username" />
          </label>
          <label class="control">
            Password
            <input id="auth-password" type="password" autocomplete="current-password" />
          </label>
        </div>
        <div id="auth-bearer-fields" class="auth-fields" hidden>
          <label class="control">
            Token
            <input id="auth-token" type="password" autocomplete="off" spellcheck="false" />
          </label>
        </div>
        <div class="auth-dialog-actions">
          <button type="button" id="auth-clear" class="secondary">Clear</button>
          <button type="button" id="auth-cancel" class="secondary">Cancel</button>
          <button type="button" id="auth-save">Save</button>
        </div>
      </form>
    </dialog>
  `;
}
