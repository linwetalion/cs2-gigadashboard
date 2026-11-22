import {
  EAuthSessionGuardType,
  EAuthTokenPlatformType,
  LoginSession,
} from "steam-session";
import { generateAuthCode } from "steam-totp";
import QRCode from "qrcode";
import {
  clearSteamSession,
  loadSteamSession,
  saveSteamSession,
  type StoredSteamSession,
} from "./token-store.js";

export type GuardKind = "email" | "totp" | "device" | "machine";

export interface LoginGuard {
  kind: GuardKind;
  detail?: string;
}

export type LoginStage =
  | "idle"
  | "awaiting_guard"
  | "awaiting_qr"
  | "authenticating"
  | "connected"
  | "error";

export interface LoginState {
  stage: LoginStage;
  accountName?: string;
  steamId?: string;
  guards: LoginGuard[];
  qrDataUrl?: string;
  error?: string;
}

interface Callbacks {
  onAuthenticated: (session: StoredSteamSession) => void;
  onLogout: () => void;
}

let callbacks: Callbacks | null = null;
let pending: LoginSession | null = null;
let state: LoginState = { stage: "idle", guards: [] };

export function configureLogin(handlers: Callbacks): void {
  callbacks = handlers;
}

export function loginState(): LoginState {
  return state;
}

export function storedSession(): StoredSteamSession | null {
  return loadSteamSession();
}

function resetPending(): void {
  if (pending) {
    try {
      pending.cancelLoginAttempt();
    } catch {
      // already finished
    }
  }
  pending = null;
}

function attach(session: LoginSession): void {
  session.loginTimeout = 5 * 60 * 1000;

  session.on("authenticated", () => {
    const stored: StoredSteamSession = {
      refreshToken: session.refreshToken!,
      steamId: session.steamID!.getSteamID64(),
      accountName: session.accountName!,
      savedAt: new Date().toISOString(),
    };
    saveSteamSession(stored);
    state = {
      stage: "connected",
      accountName: stored.accountName,
      steamId: stored.steamId,
      guards: [],
    };
    pending = null;
    callbacks?.onAuthenticated(stored);
  });

  session.on("timeout", () => {
    state = { stage: "error", guards: [], error: "Steam login timed out. Try again." };
    pending = null;
  });

  session.on("error", (error: Error) => {
    state = { stage: "error", guards: [], error: error.message };
    pending = null;
  });

  session.on("remoteInteraction", () => {
    if (state.stage === "awaiting_guard" || state.stage === "awaiting_qr") {
      state = { ...state, stage: "authenticating" };
    }
  });
}

function mapGuards(session: LoginSession, actions: Array<{ type: number; detail?: string }>): LoginGuard[] {
  return actions.map((action) => {
    if (action.type === EAuthSessionGuardType.EmailCode) {
      return { kind: "email", detail: action.detail };
    }
    if (action.type === EAuthSessionGuardType.DeviceCode) {
      return { kind: "totp" };
    }
    if (action.type === EAuthSessionGuardType.DeviceConfirmation) {
      return { kind: "device" };
    }
    return { kind: "machine", detail: action.detail };
  });
}

export async function startCredentials(input: {
  accountName: string;
  password: string;
  sharedSecret?: string;
  machineToken?: string;
}): Promise<LoginState> {
  resetPending();
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  attach(session);
  pending = session;
  state = { stage: "authenticating", accountName: input.accountName, guards: [] };

  try {
    const result = await session.startWithCredentials({
      accountName: input.accountName,
      password: input.password,
      steamGuardMachineToken: input.machineToken,
    });

    if (!result.actionRequired) {
      state = { stage: "authenticating", accountName: input.accountName, guards: [] };
      return state;
    }

    const guards = mapGuards(session, result.validActions ?? []);

    if (input.sharedSecret && guards.some((guard) => guard.kind === "totp")) {
      await session.submitSteamGuardCode(generateAuthCode(input.sharedSecret));
      state = { stage: "authenticating", accountName: input.accountName, guards };
      return state;
    }

    state = {
      stage: "awaiting_guard",
      accountName: input.accountName,
      guards,
    };
    return state;
  } catch (error) {
    state = {
      stage: "error",
      accountName: input.accountName,
      guards: [],
      error: error instanceof Error ? error.message : String(error),
    };
    pending = null;
    return state;
  }
}

export async function startQr(): Promise<LoginState> {
  resetPending();
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  attach(session);
  pending = session;
  state = { stage: "authenticating", guards: [] };

  try {
    const result = await session.startWithQR();
    if (!result.qrChallengeUrl) throw new Error("Steam did not return a QR challenge URL");
    const qrDataUrl = String(
      await QRCode.toDataURL(result.qrChallengeUrl, {
        margin: 1,
        width: 260,
        color: { dark: "#0b0f14", light: "#ffffff" },
      })
    );
    state = {
      stage: "awaiting_qr",
      guards: mapGuards(session, result.validActions ?? []),
      qrDataUrl,
    };
    return state;
  } catch (error) {
    state = {
      stage: "error",
      guards: [],
      error: error instanceof Error ? error.message : String(error),
    };
    pending = null;
    return state;
  }
}

export async function submitGuard(code: string): Promise<LoginState> {
  if (!pending) {
    state = { ...state, stage: "error", error: "No active Steam login. Start again." };
    return state;
  }
  try {
    await pending.submitSteamGuardCode(code.trim());
    state = { ...state, stage: "authenticating", error: undefined };
  } catch (error) {
    state = {
      ...state,
      stage: "awaiting_guard",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return state;
}

export function cancelLogin(): LoginState {
  resetPending();
  state = { stage: "idle", guards: [] };
  return state;
}

export function logoutSteam(): LoginState {
  resetPending();
  clearSteamSession();
  state = { stage: "idle", guards: [] };
  callbacks?.onLogout();
  return state;
}

export function markRestored(session: StoredSteamSession): void {
  state = {
    stage: "connected",
    accountName: session.accountName,
    steamId: session.steamId,
    guards: [],
  };
}
