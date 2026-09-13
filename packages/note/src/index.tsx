/* @refresh reload */
import "./lib/polyfill.ts";
import { createSignal } from "solid-js";
import { hydrate, render } from "solid-js/web";
import { Back } from "./components/Back.tsx";
import { Front } from "./components/Front.tsx";
import { Layout } from "./components/Layout.tsx";
import {
  AnkiFieldContextProvider,
  RootAnkiFieldsContextProvider,
} from "./contexts/AnkiFieldsContext.tsx";
import { BreakpointContextProvider } from "./contexts/BreakpointContext.tsx";
import { CacheContextProvider } from "./contexts/CacheContext.tsx";
import { CardStoreContextProvider } from "./contexts/CardContext.tsx";
import { ConfigContextProvider } from "./contexts/ConfigContext.tsx";
import { CtxContextProvider } from "./contexts/CtxContext.tsx";
import { FieldGroupContextProvider } from "./contexts/FieldGroupContext.tsx";
import { GeneralContextProvider } from "./contexts/GeneralContext.tsx";
import {
  generateCssVars,
  generateCssVarsDark,
  getCssVar,
  getCssVarDark,
  type KikuConfig,
  type RootDataset,
  updateConfigState,
  validateConfig,
} from "./lib/config.ts";
import { constants } from "./lib/contants.ts";
import { defaultConfig } from "./lib/default-config.ts";
import { exampleFields } from "./lib/examples.ts";
import { isNsfw } from "./lib/util.ts";
import { normalizeAnkiFields } from "./lib/migaku.ts";
import { Logger } from "./lib/logger.ts";
import {
  type AnkiDroidAPI,
  type AnkiFields,
  ankiFieldsSkeleton,
  type CacheStore,
} from "./lib/types.ts";
import "./styles/main.css";

export abstract class KikuHost extends HTMLElement {
  shadow: ShadowRoot;
  side: "front" | "back";
  ssr: boolean;
  now: number;
  #isUpdateScheduled = false;

  constructor() {
    super();
    this.now = performance.now();
    this.shadow = this.attachShadow({ mode: "open" });
    const side = this.getAttribute("side");
    this.side = side === "front" ? "front" : "back";
    this.ssr = this.hasAttribute("ssr");
  }

  //TODO: no cb
  requestUpdate() {
    if (this.#isUpdateScheduled) return;
    this.#isUpdateScheduled = true;
    queueMicrotask(() => {
      this.render();
      this.#isUpdateScheduled = false;
    });
  }

  render({
    root = document.createElement("div"),
    ankiFields = ankiFieldsSkeleton,
    config = defaultConfig,
    aborter = new AbortController(),
    ankiDroidAPI,
    logger = new Logger(),
    cacheStore = {},
    assetsPath = window.location.origin,
    workerPath,
    rootDataset,
    styleTags = [],
    initialDarkMode = document.body?.classList.contains("nightMode"),
    isAnkiWeb = false,
    isAnkiDesktop = typeof pycmd !== "undefined",
    isAnkiDroidOldStudyScreen = false,
    isAnkiDroidNewStudyScreen = false,
    isAnkiDroid = false,
  }:
    | {
        root?: HTMLElement;
        ankiFields?: AnkiFields;
        config?: KikuConfig | ((defaultConfig: KikuConfig) => KikuConfig);
        aborter?: AbortController;
        ankiDroidAPI?: AnkiDroidAPI;
        logger?: Logger;
        cacheStore?: CacheStore;
        assetsPath?: string;
        workerPath?: string;
        rootDataset?: RootDataset;
        styleTags?: HTMLStyleElement[];
        initialDarkMode?: boolean;
        isAnkiWeb?: boolean;
        isAnkiDesktop?: boolean;
        isAnkiDroidOldStudyScreen?: boolean;
        isAnkiDroidNewStudyScreen?: boolean;
        isAnkiDroid?: boolean;
      }
    | undefined = {}): {
    dispose: () => void;
    logger: Logger;
  } | void {
    const [$preStartupTime] = createSignal(performance.now() - this.now);
    const [$startupTime, $setStartupTime] = createSignal(0);
    const now = performance.now();

    logger.info("[init] start", {
      side: this.side,
      expression: ankiFields.Expression,
      ssr: this.ssr,
      isAnkiWeb,
      isAnkiDesktop,
    });

    config = typeof config === "function" ? config(defaultConfig) : config;
    updateConfigState({ root, host: this, config, styleTags });

    const App = () => (
      <BreakpointContextProvider>
        <CacheContextProvider cacheStore={cacheStore}>
          <GeneralContextProvider
            aborter={aborter}
            isAnkiWeb={isAnkiWeb}
            isAnkiDesktop={isAnkiDesktop}
            workerPath={workerPath}
            templateDataset={rootDataset ?? {}}
            ankiDroidAPI={ankiDroidAPI}
            $preStartupTime={$preStartupTime}
            $startupTime={$startupTime}
            assetsPath={assetsPath}
            logger={logger}
            root={root}
            host={this}
            styleTags={styleTags}
            initialDarkMode={initialDarkMode}
            isAnkiDroidOldStudyScreen={isAnkiDroidOldStudyScreen ?? false}
            isAnkiDroidNewStudyScreen={isAnkiDroidNewStudyScreen ?? false}
            isAnkiDroid={isAnkiDroid ?? false}
          >
            <ConfigContextProvider initialConfig={config}>
              <AnkiFieldContextProvider initialAnkiFields={ankiFields} isRoot>
                <RootAnkiFieldsContextProvider>
                  <CardStoreContextProvider
                    initialSide={this.side}
                    initialNsfw={isNsfw(ankiFields.Tags)}
                  >
                    <FieldGroupContextProvider>
                      <CtxContextProvider>
                        <Layout>{this.side === "front" ? <Front /> : <Back />}</Layout>
                      </CtxContextProvider>
                    </FieldGroupContextProvider>
                  </CardStoreContextProvider>
                </RootAnkiFieldsContextProvider>
              </AnkiFieldContextProvider>
            </ConfigContextProvider>
          </GeneralContextProvider>
        </CacheContextProvider>
      </BreakpointContextProvider>
    );

    const dispose = this.ssr ? hydrate(App, root) : render(App, root);
    $setStartupTime(performance.now() - now);
    logger.info(
      "[init] done, startup:",
      `${$preStartupTime().toFixed(1)}+${$startupTime().toFixed(1)}ms`,
    );
    return { dispose, logger };
  }
}

export class KikuHostAnki extends KikuHost {
  logger = globalThis.KIKU?.logger ?? new Logger();
  aborter: AbortController;
  config: KikuConfig | undefined | null;
  env = this.getEnv();
  assetsPath: string;
  qa: HTMLElement;
  root: HTMLElement;
  styleTags: HTMLStyleElement[] = [];
  #kikuCSSReady = false;
  #kikuPluginCSSReady = false;
  constructor() {
    super();
    if (globalThis.KIKU?.aborter) globalThis.KIKU.aborter.abort();
    this.aborter = new AbortController();

    globalThis.KIKU ??= {};
    globalThis.KIKU.aborter = this.aborter;
    globalThis.KIKU.logger = this.logger;

    this.assetsPath = this.getAssetsPath();

    const qa = document.querySelector("#qa") as HTMLElement;
    const root = document.querySelector("#kiku-root") as HTMLElement;
    if (!qa || !root) throw new Error("#qa or #kiku-root not found");
    this.qa = qa;
    this.root = root;
  }

  static get observedAttributes() {
    return ["side"];
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "side" && this.side !== value) {
      this.side = value === "front" ? "front" : "back";
      this.requestUpdate();
    }
  }

  connectedCallback() {
    try {
      this.#connectedCallback();
    } catch (e) {
      window.renderErrorFallback?.(e);
    }
  }

  #connectedCallback() {
    const { aborter, env, shadow, qa } = this;
    if (env.isAnkiDesktop) this.setupUnload();
    //TODO: enable when AnkiDroidAPI is ready on new study screen https://github.com/youyoumu/kiku/issues/30
    if (env.isAnkiDroidOldStudyScreen) this.setupAnkiDroidAPI();
    if (env.isAnkiWeb) this.removeKikuCss();

    const styleTags = this.setupStyleTags();

    this.getConfig()
      .then((config) => {
        if (aborter.signal.aborted) return;
        this.config = config;
        this.requestUpdate();
      })
      .catch((e) => window.renderErrorFallback?.(e));

    if (import.meta.env.DEV) {
      this.setupDevCss(styleTags, this.config ?? undefined);
      this.#kikuCSSReady = true;
    }

    if (!import.meta.env.DEV)
      this.getKikuCSSStyleSheet()
        .then((css) => {
          if (aborter.signal.aborted) return;
          if (!css) throw new Error("kikuCSSStyleSheet not found");
          if (!env.isAnkiWeb) this.setupKikuCSSStyleSheetObserver(qa, css);
          shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, css];
          this.#kikuCSSReady = true;
          this.requestUpdate();
        })
        .catch((e) => window.renderErrorFallback?.(e));

    this.getKikuPluginCSSStyleSheet()
      .then((css) => {
        if (aborter.signal.aborted) return;
        if (css) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, css];
        this.#kikuPluginCSSReady = true;
        this.requestUpdate();
      })
      .catch((e) => window.renderErrorFallback?.(e));

    this.requestUpdate();
  }

  render() {
    const { logger, aborter, shadow, config, root, env } = this;
    if (config === undefined || !this.#kikuCSSReady || !this.#kikuPluginCSSReady) return;
    if (globalThis.KIKU?.dispose) globalThis.KIKU.dispose();

    const rootDataset = this.getRootDataSet();
    const ankiFields = this.getAnkiFields();

    if (!shadow.contains(root)) shadow.appendChild(root);

    const res = super.render({
      root,
      ankiFields,
      config: config ?? undefined,
      aborter,
      ankiDroidAPI: globalThis.KIKU?.ankiDroidAPI,
      logger,
      cacheStore: globalThis.KIKU,
      assetsPath: this.assetsPath,
      isAnkiWeb: env.isAnkiWeb,
      rootDataset,
      styleTags: this.styleTags,
      isAnkiDroidOldStudyScreen: env.isAnkiDroidOldStudyScreen,
      isAnkiDroidNewStudyScreen: env.isAnkiDroidNewStudyScreen,
      isAnkiDroid: env.isAnkiDroid,
    });

    if (globalThis.KIKU) Object.assign(globalThis.KIKU, res);
    if (import.meta.env.DEV) root.dataset.side = this.side;
  }

  async getConfig() {
    const { logger } = this;
    let config: KikuConfig | null = null;
    try {
      const cache = sessionStorage.getItem(constants.key["kiku-config"]);
      if (cache) {
        config = validateConfig(JSON.parse(cache), logger);
        logger.info("[init] config loaded from sessionStorage");
      } else {
        const res = await fetch(constants.assets["_kiku_config.json"], { cache: "no-store" });
        const json = await res.json();
        config = validateConfig(json, logger);
        sessionStorage.setItem(constants.key["kiku-config"], JSON.stringify(config));
        logger.info("[init] config fetched and cached");
      }
    } catch (e) {
      logger.warn("[init] config load failed:", e instanceof Error ? e.message : e);
    }
    return config;
  }

  getEnv() {
    const isAnkiDesktop = typeof pycmd !== "undefined";
    const isAnkiWeb = window.location.origin.includes("ankiuser.net");
    const isAnkiDroidOldStudyScreen =
      typeof AnkiDroidJS !== "undefined" &&
      document.documentElement.classList.contains("android") &&
      !!document.querySelector("body > div#content > #qa");
    const isAnkiDroidNewStudyScreen =
      typeof AnkiDroidJS !== "undefined" &&
      document.documentElement.classList.contains("android") &&
      !!document.querySelector("body > div#qa");
    const isAnkiDroid = document.documentElement.classList.contains("android");
    return {
      isAnkiDesktop,
      isAnkiWeb,
      isAnkiDroidOldStudyScreen,
      isAnkiDroidNewStudyScreen,
      isAnkiDroid,
    };
  }

  setupUnload() {
    if (globalThis.KIKU && !globalThis.KIKU?.unload && !import.meta.env.DEV) {
      globalThis.KIKU.unload = () => {
        sessionStorage.clear();
      };
      window.addEventListener("unload", globalThis.KIKU.unload);
    }
  }

  setupAnkiDroidAPI() {
    const { logger } = this;
    if (globalThis.KIKU && !globalThis.KIKU.ankiDroidAPI && typeof AnkiDroidJS !== "undefined") {
      globalThis.KIKU.ankiDroidAPI = new AnkiDroidJS({
        version: "0.0.3",
        developer: "youyoumu",
      });
      logger.info("[init] AnkiDroidAPI initialized");
    }
  }

  getAssetsPath() {
    const { logger } = this;
    let assetsPath = window.location.origin;
    if (this.env.isAnkiWeb) {
      assetsPath = `${window.location.origin}/study/media`;
      logger.info("[init] AnkiWeb mode, assetsPath:", assetsPath);
    }
    return assetsPath;
  }

  removeKikuCss() {
    document.querySelector("#kiku-css")?.remove();
  }

  getRootDataSet() {
    const { logger, root } = this;
    const rootDataset: RootDataset = {
      theme: root.dataset.theme,
      themeDark: root.dataset.themeDark,
      blurNsfw: root.dataset.blurNsfw,
      pictureOnFront: root.dataset.pictureOnFront,
      modVertical: root.dataset.modVertical,
    };
    logger.debug("[init] rootDataset:", rootDataset);
    return rootDataset;
  }

  setupStyleTags() {
    const { shadow, qa } = this;
    const style = qa.querySelector<HTMLStyleElement>("style");
    const shadowStyle = style?.cloneNode(true) as HTMLStyleElement | undefined;
    if (shadowStyle) shadow.appendChild(shadowStyle);
    const styleTags = [style, shadowStyle].filter(Boolean) as HTMLStyleElement[];
    this.styleTags = styleTags;
    return styleTags;
  }

  async getKikuCSSStyleSheet() {
    const { aborter } = this;
    let css = globalThis.KIKU?.kikuCSSStyleSheet;
    if (css) return css;

    const res = await fetch("./_kiku.css", { signal: aborter.signal });
    const text = await res.text();
    css = new CSSStyleSheet();
    css.replaceSync(text);
    if (globalThis.KIKU) globalThis.KIKU.kikuCSSStyleSheet = css;

    return css;
  }

  async getKikuPluginCSSStyleSheet() {
    const { aborter, logger } = this;
    let css = globalThis.KIKU?.kikuPluginCSSStyleSheet;
    if (css) return css;

    try {
      const res = await fetch("./_kiku_plugin.css", { signal: aborter.signal });
      const text = await res.text();
      css = new CSSStyleSheet();
      css.replaceSync(text);
    } catch (e) {
      logger.warn(
        "[init] kiku plugin CSSStyleSheet load failed:",
        e instanceof Error ? e.message : e,
      );
    }
    if (globalThis.KIKU) globalThis.KIKU.kikuPluginCSSStyleSheet = css;

    return css;
  }

  setupKikuCSSStyleSheetObserver(qa: HTMLElement, css: CSSStyleSheet) {
    const { logger } = this;
    if (document.adoptedStyleSheets.includes(css)) {
      logger.debug("[init] kiku CSSStyleSheet already added");
      return;
    }
    logger.debug("[init] adding kiku CSSStyleSheet");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
    if (qa && globalThis.KIKU && !globalThis.KIKU.kikuCSSStyleSheetObserver) {
      const observer = new MutationObserver(() => {
        queueMicrotask(() => {
          if (!document.querySelector("#kiku-host")) {
            logger.debug("[init] removing kiku CSSStyleSheet");
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
              (sheet) => sheet !== css,
            );
          }
        });
      });
      observer.observe(qa, { childList: true });
      globalThis.KIKU.kikuCSSStyleSheetObserver = observer;
    }
  }

  getAnkiFields(): AnkiFields {
    const ankiFieldsTemplate = document.querySelector("#anki-fields");
    let templates: NodeListOf<HTMLTemplateElement> | HTMLTemplateElement[] | undefined =
      ankiFieldsTemplate instanceof HTMLTemplateElement
        ? ankiFieldsTemplate.content.querySelectorAll("template[data-field]")
        : undefined;
    if (import.meta.env.DEV) {
      templates = Object.entries(exampleFields).map(([key, value]) => {
        const fieldTemplate = document.createElement("template");
        fieldTemplate.dataset.field = key;
        fieldTemplate.innerHTML = value.toString();
        return fieldTemplate;
      });
    }
    if (!templates) return ankiFieldsSkeleton;

    const ankiFields = {
      ...ankiFieldsSkeleton,
      ...Object.fromEntries(
        Array.from(templates).map((el) => [el.dataset.field, el.innerHTML.trim()]),
      ),
    };
    return normalizeAnkiFields(ankiFields);
  }

  setupDevCss(styleTags: HTMLStyleElement[], config: KikuConfig | undefined) {
    const { shadow } = this;
    const mainCss = document.querySelector('style[type="text/css"][data-vite-dev-id$="main.css"]');
    if (!mainCss) throw new Error("main.css not found");
    shadow.appendChild(mainCss.cloneNode(true));
    const ankiCss = document.querySelector('link[href="/anki.css"]');
    if (ankiCss) shadow.appendChild(ankiCss.cloneNode(true));
    const style = document.createElement("style");
    style.innerHTML = `${generateCssVars(getCssVar(config ?? defaultConfig))}\n\n${generateCssVarsDark(getCssVarDark(config ?? defaultConfig))}`;
    document.head.appendChild(style);
    const shadowStyle = style?.cloneNode(true) as HTMLStyleElement;
    shadow.appendChild(shadowStyle);
    styleTags.push(shadowStyle);
    styleTags.push(style);
  }
}

customElements.define("kiku-host-anki", KikuHostAnki);

export { generateCssVars, generateCssVarsDark, getCssVar, getCssVarDark } from "./lib/config.ts";
export { defaultConfig } from "./lib/default-config.ts";
