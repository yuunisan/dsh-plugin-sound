//#region src/index.ts
/**
* Node half of the plugin.
*
* The browser half in `src/client/` owns every contribution: only the page can
* play audio and read the user's window focus. This entry exists so the package
* appears as an ordinary Loader row in the profile.
*/
/** Loader-visible no-op body; the browser half carries the feature. */
function apply() {}

//#endregion
export { apply };