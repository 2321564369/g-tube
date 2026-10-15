(function () {
  "use strict";

  const REPO_BASE = "https://raw.githubusercontent.com/2321564369/g-tube/main/";

  /**
   * Fetch another G-Tube HTML page and render it in this same tab.
   * This avoids opening a popup or navigating to a separate page URL.
   *
   * Example: GalaxyPageEngine.loadPage("watch.html", { youtube_id: "VIDEO_ID" })
   */
  async function loadPage(pageFile, params = {}) {
    const safePage = String(pageFile || "").replace(/^\/+/, "");
    if (!safePage || safePage.includes("..") || !/^[a-zA-Z0-9._/-]+\.html$/.test(safePage)) {
      throw new Error("Invalid G-Tube page name.");
    }

    try {
      const response = await fetch(REPO_BASE + safePage, { cache: "no-cache" });
      if (!response.ok) throw new Error("HTTP " + response.status);

      let html = await response.text();
      const baseTag = '<base href="' + REPO_BASE + '">';
      const paramsJson = JSON.stringify(params).replace(/</g, "\\u003c");
      const paramsScript = '<script>window.__GALAXY_PARAMS=' + paramsJson + ';' + '</scr' + 'ipt>';

      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, function (match) {
          return match + baseTag + paramsScript;
        });
      } else {
        html = baseTag + paramsScript + html;
      }

      // Replaces the current document in the same tab; no popup or URL redirect.
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      console.error("[Galaxy Page Engine]", error);
      alert("Couldn't load " + safePage + ": " + error.message);
    }
  }

  window.GalaxyPageEngine = Object.freeze({ loadPage });
})();