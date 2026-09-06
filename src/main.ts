import { createApp } from "vue";
import App from "./App.vue";
import { mountModules } from "./modules/loader";
import {
  detectNativePlatform,
  detectRuntimeInfo,
  detectUiPlatform,
  RUNTIME_INFO_KEY,
  runtimeInfoForNativePlatform,
} from "./lib/platform";
import { reportSmokePhase } from "./lib/smoke";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "./assets/themes/global.css";

document.documentElement.dataset.uiPlatform = detectUiPlatform(navigator);
document.documentElement.dataset.input = window.matchMedia("(pointer: coarse)").matches
  ? "coarse"
  : "fine";

async function bootstrap(): Promise<void> {
  await reportSmokePhase('webview-created');
  const nativePlatform = await detectNativePlatform();
  const runtime = nativePlatform
    ? runtimeInfoForNativePlatform(nativePlatform)
    : detectRuntimeInfo();

  if (nativePlatform) document.documentElement.dataset.uiPlatform = nativePlatform;
  await reportSmokePhase('native-host-ready');

  // 模块化装配：按 modules.config 的开关加载各能力模块。
  // core 模块（设计系统 + 主题初始化）在 loader 里执行。
  const app = createApp(App);
  app.provide(RUNTIME_INFO_KEY, runtime);
  let moduleSetupFailed = false;

  // Storage adapters must be selected before App loads its state. A native
  // capability error is still non-fatal: the handled path still renders the shell.
  await mountModules(app, undefined, runtime)
    .catch((error: unknown) => {
      moduleSetupFailed = true;
      console.error("[modules] Module setup failed; continuing with the safe fallback.", error);
    });

  app.mount("#app");
  await reportSmokePhase('vue-mounted');
  if (moduleSetupFailed) {
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("shixue:module-error")));
  }
}

void bootstrap();
