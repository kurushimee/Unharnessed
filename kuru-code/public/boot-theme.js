// Applies the saved light/dark mode before React mounts: no flash.
(() => {
  const mode = localStorage.getItem("kuru:theme") || '"system"';
  const parsed = JSON.parse(mode);
  const dark = parsed === "dark" || (parsed === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
