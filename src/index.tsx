import { ButtonItem, Field, Navigation, PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { FaKeyboard } from "react-icons/fa";
import {
  backendState,
  errorText,
  fix,
  forgetEverything,
  openSettingsWhenKeyboardOpens,
  setEnabled,
  setSetting,
  settingsValue,
  shutdown,
  start,
} from "./keyboard";
import { canInstall, checkForUpdates, installNow, installWithDecky, setAutoUpdate, updateLine, updateStatus } from "./updates";

const WAIT_FOR_KEYBOARD_MS = 20000;
let forgetPending = false;

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function Content() {
  useTick(1000);
  const st = backendState();
  const f = fix();
  const running = !!f && !f.stopped;
  const [confirmForget, setConfirmForget] = useState(false);
  useEffect(() => {
    if (!confirmForget) return;
    const timer = setTimeout(() => setConfirmForget(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmForget]);
  const install = st?.install;
  const pluginLine = `Plugin ${install?.plugin ?? "?"} · Decky ${install?.decky ?? "?"}`;
  const status = f ? f.status() : st?.enabled === false ? "off" : "loading";
  const versionLine = f?.versionLine?.() ?? "";
  const err = errorText();
  const upd = updateStatus();
  const decky = !!upd?.available && !!upd.needsDecky;
  const updateLabel = decky ? "Update with Decky…" : canInstall() ? `Update to ${upd?.latest}` : "Check for updates";
  const updateAction = () => void (decky ? installWithDecky() : canInstall() ? installNow() : checkForUpdates(true));

  const forget = async () => {
    if (forgetPending) return;
    if (!confirmForget) {
      setConfirmForget(true);
      return;
    }
    forgetPending = true;
    setConfirmForget(false);
    const ok = await forgetEverything().catch(() => false);
    forgetPending = false;
    toaster.toast({
      title: "VaporType",
      body: ok ? "Learned words, blocked words and the typing log were deleted." : "Some data could not be deleted. Try again.",
    });
  };

  const openSettings = async () => {
    Navigation.CloseSideMenus();
    toaster.toast({ title: "VaporType", body: "Open the keyboard (STEAM + X) to show its settings." });
    if (!(await openSettingsWhenKeyboardOpens(WAIT_FOR_KEYBOARD_MS)))
      toaster.toast({ title: "VaporType", body: "No keyboard opened. You can also hold the emoji key on the keyboard." });
  };

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          {st ? (
            <ToggleField
              label="Enabled"
              description="Off restores Steam's own keyboard."
              checked={st.enabled}
              onChange={(on) => void setEnabled(on)}
            />
          ) : (
            <Field label="Enabled" description="Loading keyboard settings…" />
          )}
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={!running} onClick={openSettings}>
            Keyboard settings
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Privacy">
        <PanelSectionRow>
          <ToggleField
            label="Private mode"
            description="Pauses learning, autocorrect, the typing log and the typed-text line. You can also hold Esc with a trackpad."
            checked={settingsValue("privateMode") === true}
            disabled={!running}
            onChange={(on) => setSetting("privateMode", on)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Keep typing log"
            description="Saves the words you type, with swipe paths and taps, to a file on this Deck so you can share it to help tuning. Nothing is sent anywhere."
            checked={settingsValue("typingLog") === true}
            disabled={!running}
            onChange={(on) => setSetting("typingLog", on)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={forgetPending} onClick={forget}>
            {forgetPending ? "Deleting typing data…" : confirmForget ? "Press again to forget everything" : "Forget everything"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Updates">
        <PanelSectionRow>
          <Field label="Updates" description={updateLine()} focusable />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={updateAction}>
            {updateLabel}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          {upd ? (
            <ToggleField
              label="Install updates automatically"
              description="When the keyboard is closed."
              checked={upd.autoUpdate}
              onChange={(on) => void setAutoUpdate(on)}
            />
          ) : (
            <Field label="Install updates automatically" description="Waiting for update status…" />
          )}
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Status">
        <PanelSectionRow>
          <Field
            label="Status"
            description={
              <div style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>
                {[status, versionLine, pluginLine, err].filter(Boolean).join("\n")}
              </div>
            }
            focusable
          />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  void start();
  return {
    name: "VaporType",
    titleView: <div className={staticClasses.Title}>VaporType</div>,
    content: <Content />,
    icon: <FaKeyboard />,
    onDismount() {
      shutdown();
    },
  };
});
