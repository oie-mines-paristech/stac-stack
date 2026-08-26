import type { StoreAuth } from "../auth.js";
import { connectStore, type OpenDatasetResult } from "../store.js";
import { CorsBlockedError, CORS_STATIC_DEPLOYMENT_MESSAGE } from "../proxy.js";
import { resolveStoreUrl } from "../url_state.js";

export interface ConnectDialogOptions {
  getStoreUrl: () => string;
  getAuth: () => StoreAuth | undefined;
  onConnect: (storeUrl: string, auth: StoreAuth | undefined, dataset: OpenDatasetResult) => void | Promise<void>;
}

export function formatConnectError(error: unknown): string {
  if (error instanceof CorsBlockedError) {
    return CORS_STATIC_DEPLOYMENT_MESSAGE;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("(authentication required?)") || /\b401\b/.test(message)) {
    return "Authentication failed. Check your login or token.";
  }
  if (message.includes("No image-like variables")) {
    return "Store opened but no displayable variables found.";
  }
  if (message === "Empty store URL") {
    return "Enter a store URL.";
  }
  return message;
}

export function wireConnectDialog(options: ConnectDialogOptions): {
  open: () => void;
  setLoading: (loading: boolean) => void;
} {
  function el<T extends HTMLElement>(selector: string): T {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing element ${selector}`);
    return node as T;
  }

  const dialog = el<HTMLDialogElement>("#connect-dialog");
  const urlInput = el<HTMLInputElement>("#connect-url");
  const modeNone = el<HTMLInputElement>("#connect-mode-none");
  const modeLogin = el<HTMLInputElement>("#connect-mode-login");
  const modeToken = el<HTMLInputElement>("#connect-mode-token");
  const loginFields = el<HTMLDivElement>("#connect-login-fields");
  const tokenFields = el<HTMLDivElement>("#connect-token-fields");
  const usernameInput = el<HTMLInputElement>("#connect-username");
  const passwordInput = el<HTMLInputElement>("#connect-password");
  const tokenInput = el<HTMLInputElement>("#connect-token");
  const connectButton = el<HTMLButtonElement>("#connect-submit");
  const clearButton = el<HTMLButtonElement>("#connect-clear-auth");
  const cancelButton = el<HTMLButtonElement>("#connect-cancel");
  const errorEl = el<HTMLParagraphElement>("#connect-error");

  let connecting = false;

  function syncModeVisibility(): void {
    const showLogin = modeLogin.checked;
    const showToken = modeToken.checked;
    loginFields.hidden = !showLogin;
    tokenFields.hidden = !showToken;
  }

  function clearError(): void {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  function setError(message: string): void {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function setLoading(loading: boolean): void {
    connecting = loading;
    connectButton.disabled = loading;
    clearButton.disabled = loading;
    cancelButton.disabled = loading;
    urlInput.disabled = loading;
    usernameInput.disabled = loading;
    passwordInput.disabled = loading;
    tokenInput.disabled = loading;
    modeLogin.disabled = loading;
    modeToken.disabled = loading;
    modeNone.disabled = loading;
    connectButton.textContent = loading ? "Connecting…" : "Connect";
  }

  function populateFromState(): void {
    urlInput.value = options.getStoreUrl();
    const auth = options.getAuth();
    usernameInput.value = "";
    passwordInput.value = "";
    tokenInput.value = "";

    if (auth?.kind === "basic") {
      modeLogin.checked = true;
      usernameInput.value = auth.username;
      passwordInput.value = auth.password;
    } else if (auth?.kind === "bearer") {
      modeToken.checked = true;
      tokenInput.value = auth.token;
    } else {
      modeNone.checked = true;
    }
    syncModeVisibility();
    clearError();
  }

  function readAuthFromForm(): StoreAuth | undefined {
    if (modeNone.checked) return undefined;
    if (modeToken.checked) {
      const token = tokenInput.value.trim();
      return token ? { kind: "bearer", token } : undefined;
    }
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    return username ? { kind: "basic", username, password } : undefined;
  }

  async function submitConnect(): Promise<void> {
    if (connecting) return;

    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      setError("Enter a store URL.");
      return;
    }

    const storeUrl = resolveStoreUrl(rawUrl);
    const auth = readAuthFromForm();

    clearError();
    setLoading(true);
    try {
      const dataset = await connectStore(storeUrl, auth);
      dialog.close();
      await options.onConnect(storeUrl, auth, dataset);
    } catch (error) {
      setError(formatConnectError(error));
    } finally {
      setLoading(false);
    }
  }

  function open(): void {
    populateFromState();
    dialog.showModal();
  }

  modeNone.addEventListener("change", syncModeVisibility);
  modeLogin.addEventListener("change", syncModeVisibility);
  modeToken.addEventListener("change", syncModeVisibility);

  cancelButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });

  clearButton.addEventListener("click", () => {
    modeNone.checked = true;
    usernameInput.value = "";
    passwordInput.value = "";
    tokenInput.value = "";
    syncModeVisibility();
    clearError();
  });

  connectButton.addEventListener("click", () => {
    void submitConnect();
  });

  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitConnect();
    }
  });

  return { open, setLoading };
}

export function connectDialogMarkup(): string {
  return `
    <dialog id="connect-dialog" class="auth-dialog connect-dialog">
      <form method="dialog" class="auth-dialog-form">
        <h2>Open dataset</h2>
        <p class="muted auth-warning">
          Credentials will be included in the viewer URL (browser history, logs, sharing).
        </p>
        <label class="control">
          Store URL
          <input
            id="connect-url"
            type="text"
            name="zarr-store-url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="https://… or /path/to/store.zarr/"
          />
        </label>
        <p id="connect-error" class="connect-error" hidden role="alert"></p>
        <fieldset class="auth-mode-fieldset">
          <legend>Authentication</legend>
          <label class="auth-mode-option">
            <input type="radio" name="connect-auth-mode" id="connect-mode-none" value="none" checked />
            None
          </label>
          <label class="auth-mode-option">
            <input type="radio" name="connect-auth-mode" id="connect-mode-login" value="login" />
            Login
          </label>
          <label class="auth-mode-option">
            <input type="radio" name="connect-auth-mode" id="connect-mode-token" value="token" />
            Token
          </label>
        </fieldset>
        <div id="connect-login-fields" class="auth-fields" hidden>
          <label class="control">
            Username
            <input id="connect-username" type="text" autocomplete="username" />
          </label>
          <label class="control">
            Password
            <input id="connect-password" type="password" autocomplete="current-password" />
          </label>
        </div>
        <div id="connect-token-fields" class="auth-fields" hidden>
          <label class="control">
            Token
            <input id="connect-token" type="password" autocomplete="off" spellcheck="false" />
          </label>
        </div>
        <div class="auth-dialog-actions">
          <button type="button" id="connect-clear-auth" class="secondary">Clear auth</button>
          <button type="button" id="connect-cancel" class="secondary">Cancel</button>
          <button type="button" id="connect-submit">Connect</button>
        </div>
      </form>
    </dialog>
  `;
}
