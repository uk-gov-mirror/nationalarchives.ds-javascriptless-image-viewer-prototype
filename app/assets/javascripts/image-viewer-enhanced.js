//
// Progressive enhancement: accessible image page → Universal Viewer
// ------------------------------------------------------------------
// Finds [data-uv-enhance], loads UV.js (will be imported from the package when connected to real app),
// checks the IIIF manifest is reachable (prefetched before UV loads), then mounts UV.
// Without JS (or if UV / the manifest can't be loaded), the static fallback stays put
// — UV's hardcoded alert("Unable to load manifest") is avoided by never calling UV.init on a failing URL.
//
// URL model (UV's IIIFURLAdapter):
//   path  — no-JS truth (which static image page this is)
//   hash  — enhanced viewer state (#?cv=…)
//

/**
 * DOM and data attributes for a page that can be upgraded to Universal Viewer.
 *
 * @typedef {object} UvEnhanceElements
 * @property {Element} root - Root `[data-uv-enhance]` element.
 * @property {HTMLElement} mount - UV mount (`#uv-enhanced`).
 * @property {Element|null} fallback - No-JS fallback (`[data-uv-fallback]`), if present.
 * @property {string} manifestUrl - IIIF manifest URL from `data-iiif-manifest`.
 * @property {string|null} loginUrl - Login URL from `data-uv-login-url`, if set.
 * @property {number} canvasIndex - Canvas to open when `#?cv=` is absent (`data-canvas-index`).
 */

/**
 * Result of preflighting the IIIF manifest before calling `UV.init`.
 *
 * @typedef {object} ManifestFetchResult
 * @property {boolean} ok - Whether the response is usable JSON for UV.
 * @property {number} [status] - HTTP status, or `0` on network failure.
 */

/**
 * Collects the enhance root, UV mount, fallback, and related data attributes.
 *
 * @returns {UvEnhanceElements|null} Page context, or `null` if required markup is missing.
 */
function getElements() {
  const root = document.querySelector('[data-uv-enhance]');
  const mount = document.getElementById('uv-enhanced');
  const fallback = root && root.querySelector('[data-uv-fallback]');

  if (!root || !mount) {
    return null;
  }

  const manifestUrl = root.getAttribute('data-iiif-manifest');
  if (!manifestUrl) {
    return null;
  }

  const canvasIndex = Number(root.getAttribute('data-canvas-index') || 0);

  return {
    root,
    mount,
    fallback,
    manifestUrl,
    loginUrl: root.getAttribute('data-uv-login-url'),
    canvasIndex: Number.isNaN(canvasIndex) ? 0 : canvasIndex
  };
}

/**
 * Whether Universal Viewer and its URL adapter are available on `window`.
 *
 * @returns {boolean}
 */
function canEnhance() {
  return typeof UV !== 'undefined' && typeof UV.IIIFURLAdapter !== 'undefined';
}

/**
 * Hides the no-JS fallback and shows the UV mount (avoids a flash during prefetch).
 *
 * @param {UvEnhanceElements} elements
 * @returns {void}
 */
function beginEnhancement(elements) {
  if (elements.fallback) {
    elements.fallback.hidden = true;
  }

  elements.mount.hidden = false;
  elements.root.classList.add('tna-image-viewer-enhanced--active');
}

/**
 * Restores the no-JS fallback after a failed enhance attempt.
 *
 * @param {UvEnhanceElements} elements
 * @returns {void}
 */
function restoreFallback(elements) {
  elements.mount.hidden = true;
  elements.root.classList.remove('tna-image-viewer-enhanced--active');

  if (elements.fallback) {
    elements.fallback.hidden = false;
  }
}

/**
 * Handles an unauthenticated manifest response (placeholder until auth is setup).
 *
 * @param {string|null} loginUrl
 * @returns {void}
 */
function showLoginPrompt(loginUrl) {
  if (!loginUrl) {
    return;
  }

  console.log('Take user to login page', loginUrl);
}

/**
 * Restores the fallback and routes auth failures to login; other errors stay on the static viewer.
 * Does not call `UV.init` — that would trigger UV's `alert("Unable to load manifest")`.
 *
 * @param {UvEnhanceElements} elements
 * @param {number} status - HTTP status, or `0` on network failure.
 * @returns {void}
 */
function handleManifestFailure(elements, status) {
  restoreFallback(elements);

  if (status === 401 || status === 403) {
    showLoginPrompt(elements.loginUrl);
    return;
  }

  console.warn('IIIF manifest unavailable', status || 'network error');
}

/**
 * Prefetches the manifest so we can branch on status/body before UV loads it.
 * Treats non-OK responses and non-JSON bodies (e.g. login HTML at 200) as failure.
 *
 * Does not check for valid IIIF manifest, only that the response is JSON.
 *
 * @param {string} manifestUrl
 * @returns {Promise<ManifestFetchResult>}
 */
async function fetchManifest(manifestUrl) {
  let response;

  try {
    response = await fetch(manifestUrl, {
      credentials: 'same-origin'
    });
  } catch {
    return { ok: false, status: 0 };
  }

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    console.warn('IIIF manifest response was not JSON', contentType || '(no content-type)');
    return { ok: false, status: response.status };
  }

  try {
    await response.json();
  } catch {
    console.warn('IIIF manifest response could not be parsed as JSON');
    return { ok: false, status: response.status };
  }

  return { ok: true };
}

/**
 * UV configuration overrides that differ from shipped defaults (footer chrome, one-up paging, etc.).
 *
 * @type {object}
 */
const UV_FOOTER_BUTTONS = {
  downloadEnabled: false,
  shareEnabled: false,
  openEnabled: false,
  moreInfoEnabled: false
};

const UV_CONFIG = {
  options: {
    // Auth details TBC once implemented with backend
    // authAPIVersion: 1,
    // tokenStorage: 'session',
    pagingEnabled: false,
    dropEnabled: false,
    saveUserSettings: false,
    searchWithinEnabled: false
  },
  modules: {
    contentLeftPanel: {
      options: {
        panelExpandedWidth: 400
      }
    },
    pagingHeaderPanel: {
      options: {
        modeOptionsEnabled: false
      }
    },
    openSeadragonCenterPanel: {
      options: {
        subtitleEnabled: false
      }
    },
    downloadDialogue: {
      options: {
        selectionEnabled: false
      }
    },
    footerPanel: { options: UV_FOOTER_BUTTONS },
    searchFooterPanel: { options: UV_FOOTER_BUTTONS },
    mobileFooterPanel: { options: UV_FOOTER_BUTTONS }
  }
};

/**
 * Loads Universal Viewer's UMD build if it is not already on the page.
 * Under Webpack this dynamic `<script>` insert can go — import UV from the
 * package instead. Keep restoring the fallback if the UV chunk still fails
 * to load.
 *
 * @param {string} [src='/universalviewer/umd/UV.js']
 * @returns {Promise<void>}
 */
function loadUniversalViewerScript(src = '/universalviewer/umd/UV.js') {
  if (canEnhance()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
}

/**
 * Initialises Universal Viewer with the IIIF URL adapter and host config overrides.
 * Hash `#?cv=` wins when present; otherwise uses `elements.canvasIndex`.
 *
 * @param {UvEnhanceElements} elements
 * @returns {void}
 */
function mountUniversalViewer(elements) {
  // Writable adapter so bindTo can update #?cv=… on canvas change.
  const urlAdapter = new UV.IIIFURLAdapter();
  const initialData = {
    iiifManifestId: elements.manifestUrl,
    embedded: true
  };

  // Hash cv wins when present; otherwise open on this page's canvas.
  if (typeof urlAdapter.get('cv') === 'undefined') {
    initialData.canvasIndex = elements.canvasIndex;
  }

  const uv = UV.init('uv-enhanced', urlAdapter.getInitialData(initialData));

  uv.on('configure', (args) => {
    args.cb(UV_CONFIG);
  });

  urlAdapter.bindTo(uv);
}

/**
 * Entry point: hide the fallback, load UV, prefetch the manifest, then mount.
 * If this script never loads, the fallback stays visible. If UV.js fails, restore it.
 *
 * @returns {Promise<void>}
 */
async function init() {
  const elements = getElements();
  if (!elements) {
    return;
  }

  // Hide before loading UV / prefetching so the static viewer does not flash.
  beginEnhancement(elements);

  try {
    await loadUniversalViewerScript();
  } catch (error) {
    console.warn(error.message || error);
    restoreFallback(elements);
    return;
  }

  if (!canEnhance()) {
    restoreFallback(elements);
    return;
  }

  const result = await fetchManifest(elements.manifestUrl);
  if (!result.ok) {
    handleManifestFailure(elements, result.status);
    return;
  }

  mountUniversalViewer(elements);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
