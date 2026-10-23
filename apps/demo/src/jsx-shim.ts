/* jsx-runtime sobre o React global (UMD carregado da CDN no build de demonstração). */
declare const React: typeof import("react");
const R = (globalThis as unknown as { React: typeof import("react") }).React;
export const Fragment = R.Fragment;
export function jsx(type: never, props: Record<string, unknown>, key?: string) { return R.createElement(type, key === undefined ? props : { ...props, key }); }
export const jsxs = jsx;
export const jsxDEV = jsx;
