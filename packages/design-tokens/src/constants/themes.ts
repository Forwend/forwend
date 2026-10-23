export const THEMES = {
  light: "light",
  dark: "dark",
} as const;

/** Attribute on <html> (or any section) that selects the theme. */
export const THEME_ATTRIBUTE = "data-theme";

/** localStorage key for the visitor's explicit choice. No key means "follow the system". */
export const THEME_STORAGE_KEY = "fw-theme";

/** Runs in <head> before the first paint; kept tiny because it is inlined into every page. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
