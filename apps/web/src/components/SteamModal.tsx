import { useEffect, useState } from "react";
import {
  steamApi,
  type HistoryStatus,
  type SteamLoginState,
  type SteamStatus,
} from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: (status: SteamStatus) => void;
}

type View = "menu" | "password" | "qr";

export function SteamModal({ open, onClose, onChanged }: Props) {
  const [status, setStatus] = useState<SteamStatus | null>(null);
  const [view, setView] = useState<View>("menu");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [sharedSecret, setSharedSecret] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryStatus | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [knownCode, setKnownCode] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);

  const apply = (next: SteamLoginState) => {
    setStatus((current) => (current ? { ...current, login: next } : current));
  };

  const refresh = async () => {
    try {
      const next = await steamApi.status();
      setStatus(next);
      onChanged(next);
      return next;
    } catch (reason) {
      setError(String(reason));
      return null;
    }
  };

  const refreshHistory = async () => {
    try {
      const payload = await steamApi.history();
      setHistory(payload.status);
    } catch {
      // history is optional until the API key is configured
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    void refreshHistory();
    const timer = window.setInterval(() => {
      void refresh();
      void refreshHistory();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) return null;

  const login = status?.login;
  const worker = status?.worker;
  const connected = login?.stage === "connected" || (status?.hasToken && worker?.loggedOn);

  const run = async (action: () => Promise<SteamLoginState>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      apply(next);
      if (next.error) setError(next.error);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer steam-drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div>
            <div className="eyebrow">Steam · Game Coordinator</div>
            <h2>Подключение Steam</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <p className="drawer-lead">
          Логин нужен, чтобы получать список матчей и детали через CS2 Game Coordinator. Пароль не
          сохраняется. Refresh-token шифруется и остаётся на этой машине.
        </p>

        {connected && (
          <section className="steam-connected">
            <div className="steam-state">
              <span className={`dot ${worker?.loggedOn ? "high" : "medium"}`} />
              <div>
                <b>{login?.accountName ?? worker?.accountName ?? "Steam"}</b>
                <span>{login?.steamId ?? worker?.steamId ?? ""}</span>
              </div>
            </div>
            <div className="steam-flags">
              <span className={worker?.loggedOn ? "ok" : "off"}>Steam {worker?.loggedOn ? "online" : "offline"}</span>
              <span className={worker?.gcConnected ? "ok" : "off"}>GC {worker?.gcConnected ? "connected" : "waiting"}</span>
              <span className="off">{worker?.requests ?? 0} запросов</span>
            </div>
            {worker?.lastError && <p className="warn">{worker.lastError}</p>}
            <div className="steam-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await steamApi.sync();
                    setNotice(result.message);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Синхронизировать сейчас
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  if (confirm("Отключить Steam и удалить сохранённый токен?")) {
                    void run(() => steamApi.logout());
                  }
                }}
              >
                Отключить
              </button>
            </div>
            {notice && <p className="notice">{notice}</p>}

            <div className="steam-history">
              <h3>Полная история матчей</h3>
              <p className="muted small">
                GC отдаёт только последние 8 матчей. Чтобы подтянуть историю за 1,5 года, нужен
                Game Authentication Code + один старый share-код из Steam Support / gcpd.
              </p>
              {!status?.hasApiKey && (
                <p className="warn small">
                  Добавь `STEAM_API_KEY` в `.env` и перезапусти сервер, иначе Steam не отдаст
                  цепочку share-кодов.
                </p>
              )}
              <label>
                <span>Game Authentication Code</span>
                <input
                  value={authCode}
                  onChange={(event) => setAuthCode(event.target.value)}
                  placeholder="AAAA-AAAAA-AAAA"
                />
              </label>
              <label>
                <span>Старый share-код</span>
                <input
                  value={knownCode}
                  onChange={(event) => setKnownCode(event.target.value)}
                  placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
                />
              </label>
              <button
                className="ghost"
                disabled={historyBusy || history?.running || !authCode || !knownCode}
                onClick={async () => {
                  setHistoryBusy(true);
                  setError(null);
                  try {
                    const result = await steamApi.startHistory(authCode, knownCode);
                    setHistory(result);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                  } finally {
                    setHistoryBusy(false);
                  }
                }}
              >
                {history?.running ? "Загрузка истории…" : "Загрузить историю"}
              </button>
              {history && history.phase !== "idle" && (
                <div className="history-progress">
                  <div className="history-bar">
                    <i
                      style={{
                        width: `${
                          history.total ? Math.min(100, (history.processed / history.total) * 100) : 5
                        }%`,
                      }}
                    />
                  </div>
                  <span className="muted small">
                    {history.phase}: {history.processed}/{history.total}
                    {history.failed ? ` · ошибок ${history.failed}` : ""}
                  </span>
                  {history.lastError && <span className="warn small">{history.lastError}</span>}
                </div>
              )}
            </div>
          </section>
        )}

        {!connected && view === "menu" && (
          <section className="steam-menu">
            <button className="steam-choice" onClick={() => setView("password")}>
              <b>Логин и пароль</b>
              <span>Steam Guard подтвердится кодом или в приложении</span>
            </button>
            <button
              className="steam-choice"
              disabled={busy}
              onClick={async () => {
                setView("qr");
                await run(() => steamApi.qr());
              }}
            >
              <b>QR-код</b>
              <span>Отсканировать в мобильном приложении Steam</span>
            </button>
          </section>
        )}

        {!connected && view === "password" && (
          <section className="steam-form">
            <label>
              <span>Имя аккаунта</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                autoComplete="username"
                placeholder="steam account name"
              />
            </label>
            <label>
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="не сохраняется"
              />
            </label>
            <button className="link-btn" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? "Скрыть" : "Есть shared_secret для TOTP?"}
            </button>
            {showAdvanced && (
              <label>
                <span>shared_secret (необязательно)</span>
                <input
                  value={sharedSecret}
                  onChange={(event) => setSharedSecret(event.target.value)}
                  placeholder="base64 shared_secret"
                />
              </label>
            )}
            <button
              className="primary"
              disabled={busy || !accountName || !password}
              onClick={() =>
                run(() =>
                  steamApi.login({
                    accountName,
                    password,
                    sharedSecret: sharedSecret || undefined,
                  })
                )
              }
            >
              {busy ? "Подключение…" : "Войти"}
            </button>
            <p className="muted small">
              Пароль отправляется только на ваш локальный сервер и не пишется в БД или логи.
            </p>
          </section>
        )}

        {!connected && view === "qr" && (
          <section className="steam-qr">
            {login?.qrDataUrl ? (
              <>
                <img src={login.qrDataUrl} alt="Steam QR" />
                <p>Откройте Steam → «Вход по QR-коду» и отсканируйте.</p>
              </>
            ) : (
              <p className="muted">Генерируем QR…</p>
            )}
          </section>
        )}

        {!connected && login?.stage === "awaiting_guard" && (
          <section className="steam-form">
            <h3>Steam Guard</h3>
            {login.guards.map((guard, index) => (
              <p key={index} className="muted small">
                {guard.kind === "email" && `Код отправлен на ${guard.detail ?? "email"}`}
                {guard.kind === "totp" && "Введите код из мобильного аутентификатора"}
                {guard.kind === "device" && "Подтвердите вход в приложении Steam и подождите"}
                {guard.kind === "machine" && "Требуется машинный токен"}
              </p>
            ))}
            <label>
              <span>Код</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="XXXXX"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && code) void run(() => steamApi.guard(code));
                }}
              />
            </label>
            <button className="primary" disabled={busy || !code} onClick={() => run(() => steamApi.guard(code))}>
              Подтвердить
            </button>
          </section>
        )}

        {!connected && login?.stage === "authenticating" && <p className="notice">Ожидаем подтверждение Steam…</p>}

        {error && <p className="warn">{error}</p>}

        {!connected && (view !== "menu" || login?.stage === "awaiting_guard") && (
          <button
            className="ghost"
            onClick={() => {
              void run(() => steamApi.cancel());
              setView("menu");
            }}
          >
            Назад
          </button>
        )}
      </aside>
    </div>
  );
}
