declare module "chrome-remote-interface" {
  type Client = {
    Network: {
      enable: () => Promise<void>;
      getAllCookies: () => Promise<{
        cookies: Array<{ name: string; value: string; domain?: string }>;
      }>;
    };
    Storage: {
      getCookies: (opts: Record<string, unknown>) => Promise<{
        cookies: Array<{ name: string; value: string; domain?: string }>;
      }>;
    };
    Page: {
      enable: () => Promise<void>;
      navigate: (opts: { url: string }) => Promise<unknown>;
    };
    close: () => Promise<void>;
  };
  export default function CDP(opts?: { port?: number }): Promise<Client>;
}
